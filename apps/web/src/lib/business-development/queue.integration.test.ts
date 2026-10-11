import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Pool } from "pg";
import { BusinessDirector } from "./queue.ts";
import { isolatedDatabaseUrl, SAFE_KINDS } from "./policy.ts";
import type { Task } from "./queue.ts";

// Deliberately fail instead of skipping if a real PostgreSQL test DB was not supplied.
const connectionString = isolatedDatabaseUrl(process.env.BG_V2_TEST_DATABASE_URL);
if (new URL(connectionString).pathname !== "/bg_company_v2_test") throw new Error("TEST_DATABASE_REQUIRED");
const pool = new Pool({ connectionString,max: 16,connectionTimeoutMillis: 5000 });
const director = new BusinessDirector(pool);
const sql = await readFile(new URL("../../../../../infrastructure/bg-company-v2/001_control_plane.sql",import.meta.url),"utf8");
test.after(async () => { await pool.end(); });

async function setup() {
  await pool.query(sql);
  await pool.query("TRUNCATE bg_company_v2.event,bg_company_v2.attempt,bg_company_v2.task_dependency,bg_company_v2.task,bg_company_v2.project RESTART IDENTITY CASCADE");
  await pool.query("UPDATE bg_company_v2.usage_gate SET state='unknown',source='unverified',valid_until=NULL,remaining_percent=NULL");
  return director.startProject("initial","BG Company 2.0 isolated test");
}
function token(task: Task) { assert.ok(task.lease_token); return task.lease_token; }
async function expire(task: Task) {
  await pool.query("UPDATE bg_company_v2.task SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",[task.id]);
}
async function makeDue(task: Task) {
  await pool.query("UPDATE bg_company_v2.task SET not_before=clock_timestamp()-interval '1 second' WHERE id=$1",[task.id]);
}

test("migration is repeatable and leaves unrelated data intact",async () => {
  await pool.query("CREATE TABLE IF NOT EXISTS public.bg_v2_preservation_probe(id integer PRIMARY KEY,value text)");
  await pool.query("INSERT INTO public.bg_v2_preservation_probe VALUES (1,'preserved') ON CONFLICT DO NOTHING");
  await pool.query(sql); await pool.query(sql);
  assert.equal((await pool.query("SELECT value FROM public.bg_v2_preservation_probe WHERE id=1")).rows[0].value,"preserved");
  assert.equal((await pool.query("SELECT count(*)::int AS count FROM bg_company_v2.schema_version")).rows[0].count,1);
});
test("concurrent project requests are idempotent and a second business cannot start",async () => {
  const p = await setup();
  const projects = await Promise.all(Array.from({length: 12},() => director.startProject("initial",p.title)));
  assert.ok(projects.every((v) => v.id === p.id));
  assert.equal((await director.status()).tasks.length,6);
  await assert.rejects(director.startProject("other","second business"),/BUSINESS_ALREADY_ACTIVE/);
  await assert.rejects(director.startProject("initial","different title"),/IDEMPOTENCY_CONFLICT/);
  await director.setProjectPaused(p.id,true);
  await assert.rejects(director.startProject("other","second business"),/BUSINESS_ALREADY_ACTIVE/);
});
test("concurrent enqueue requests produce one task and reject conflicting definitions",async () => {
  const p = await setup();
  const tasks = await Promise.all(Array.from({length: 10},() => director.enqueue(p.id,"qa","extra-qa")));
  assert.ok(tasks.every((v) => v.id === tasks[0].id));
  await assert.rejects(director.enqueue(p.id,"build","extra-qa"),/IDEMPOTENCY_CONFLICT/);
  await assert.rejects(director.enqueue(p.id,"qa","bad-dependency",["aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"]),/INVALID_DEPENDENCY/);
});
test("unknown, exhausted, stale and reserve usage all stop execution",async () => {
  await setup();
  assert.equal(await director.claim("worker"),null);
  assert.ok((await director.status()).tasks.every((t) => t.status === "blocked_usage"));
  await director.recordVerifiedAvailability(60_000,20);
  assert.equal(await director.claim("worker"),null);
  await director.recordVerifiedAvailability(60_000,90);
  await pool.query("UPDATE bg_company_v2.usage_gate SET valid_until=clock_timestamp()-interval '1 second'");
  assert.equal(await director.claim("worker"),null);
  await director.recordVerifiedAvailability(60_000,90);
  const task = await director.claim("worker"); assert.ok(task);
  assert.equal(await director.finish(task.id,token(task),{status: "blocked_usage",errorCode: "QUOTA_EXHAUSTED"}),true);
  assert.equal((await director.status()).usage.state,"exhausted");
  assert.equal(await director.claim("worker"),null);
  await director.recordVerifiedAvailability(60_000,90);
  const next = await director.claim("worker"); assert.ok(next);
  assert.equal(next.id,task.id);
});
test("16 concurrent workers get one lease; dependency ordering survives reconnect",async () => {
  await setup(); await director.recordVerifiedAvailability(60_000);
  const claims = await Promise.all(Array.from({length: 16},(_,i) => director.claim(`worker-${i}`)));
  const nonNull = claims.filter((v) => v !== null);
  assert.equal(nonNull.length,1);
  const task = nonNull[0]; assert.equal(task.kind,"research");
  assert.equal(await director.finish(task.id,"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",{status:"succeeded"}),false);
  assert.equal(await director.finish(task.id,token(task),{status:"succeeded",artifacts:{commitSha:"a".repeat(40)}}),true);
  const otherPool = new Pool({connectionString,max:2});
  try {
    const afterRestart = new BusinessDirector(otherPool);
    const next = await afterRestart.claim("reconnected-worker"); assert.ok(next);
    assert.equal(next.kind,"plan");
    assert.equal((await afterRestart.status()).tasks.find((t) => t.id === task.id)?.status,"succeeded");
  } finally { await otherPool.end(); }
});
test("expired lease blocks all new execution until original process exit is confirmed",async () => {
  const p = await setup(); await director.recordVerifiedAvailability(60_000);
  const task = await director.claim("old-worker"); assert.ok(task);
  await director.enqueue(p.id,"qa","independent-qa");
  await expire(task);
  assert.equal(await director.claim("new-worker"),null);
  assert.equal(await director.finish(task.id,token(task),{status:"succeeded"}),false);
  await assert.rejects(director.retryInterrupted(task.id),/PROCESS_STOP_UNCONFIRMED/);
  assert.equal(await director.confirmStopped(token(task)),true);
  await director.retryInterrupted(task.id);
  const replacement = await director.claim("replacement"); assert.ok(replacement);
  assert.equal(replacement.id,task.id);
  assert.notEqual(token(replacement),token(task));
  assert.equal(await director.heartbeat(task.id,token(task)),false);
  assert.equal(await director.finish(task.id,token(task),{status:"succeeded"}),false);
});
test("pause revokes heartbeat and prevents success until worker stops",async () => {
  const p = await setup(); await director.recordVerifiedAvailability(60_000);
  const task = await director.claim("worker"); assert.ok(task);
  await director.setProjectPaused(p.id,true);
  assert.equal(await director.heartbeat(task.id,token(task)),false);
  assert.equal(await director.finish(task.id,token(task),{status:"succeeded"}),false);
  assert.equal(await director.finish(task.id,token(task),{status:"interrupted",errorCode:"EXECUTION_STOPPED"}),true);
  await director.retryInterrupted(task.id);
  assert.equal(await director.claim("worker"),null);
  await director.setProjectPaused(p.id,false);
  assert.ok(await director.claim("worker"));
});
test("retry backoff and attempt limit prevent infinite failure loops",async () => {
  await setup(); await director.recordVerifiedAvailability(60_000);
  let previous: Task | null = null;
  for (let i=0;i<3;i++) {
    const task = await director.claim("worker"); assert.ok(task);
    if (previous) assert.equal(task.id,previous.id);
    assert.equal(task.attempt_count,i+1);
    await director.finish(task.id,token(task),{status:"failed",errorCode:"BUILD_FAILED"});
    assert.equal(await director.claim("too-soon"),null);
    await makeDue(task); previous=task;
  }
  assert.equal((await director.status()).tasks.find((t) => t.id === previous!.id)?.status,"failed");
  assert.equal(await director.claim("worker"),null);
});
test("restricted actions remain held even after every safe stage succeeds",async () => {
  const p = await setup(); await director.recordVerifiedAvailability(60_000);
  for (const action of ["public_release","payments","permissions","paid_api"] as const) {
    assert.equal((await director.enqueue(p.id,action,action)).status,"awaiting_approval");
  }
  for (const stage of SAFE_KINDS) {
    const task = await director.claim("test-harness"); assert.ok(task); assert.equal(task.kind,stage);
    await director.finish(task.id,token(task),{status:"succeeded"});
  }
  assert.equal(await director.claim("worker"),null);
  await assert.rejects(director.completeProject(p.id),/PROJECT_HAS_UNFINISHED_TASKS/);
  const held = (await director.status()).tasks.find((t) => t.kind === "payments"); assert.ok(held);
  await assert.rejects(pool.query("UPDATE bg_company_v2.task SET status='queued' WHERE id=$1",[held.id]),/check constraint/);
});
test("successful work is never rerun; evidence is durable and unknown costs stay null",async () => {
  const p = await setup(); await director.recordVerifiedAvailability(60_000);
  for (const stage of SAFE_KINDS) {
    const task = await director.claim("test-harness"); assert.ok(task); assert.equal(task.kind,stage);
    await director.finish(task.id,token(task),{status:"succeeded",artifacts:{tests:{passed:5,failed:0}},inputTokens:123,outputTokens:456});
  }
  const state = await director.status();
  assert.ok(state.attempts.every((a) => a.actual_cost_micros === null && a.currency === null));
  assert.ok(state.attempts.every((a) => a.artifacts.tests.passed === 5));
  assert.equal(await director.claim("worker"),null);
  await director.completeProject(p.id);
  assert.equal((await director.startProject("next","next isolated business")).status,"active");
  assert.ok(state.tasks.every((t) => !("lease_token" in t)));
});
test("failed tests and secret-bearing evidence cannot be reported as success",async () => {
  await setup(); await director.recordVerifiedAvailability(60_000);
  const task = await director.claim("worker"); assert.ok(task);
  await assert.rejects(director.finish(task.id,token(task),{status:"succeeded",artifacts:{tests:{passed:0,failed:1}}}),/FAILED_TESTS/);
  await assert.rejects(director.finish(task.id,token(task),{status:"succeeded",artifacts:{paths:[".env"]}}),/INVALID_ARTIFACT_PATH/);
  assert.equal(await director.heartbeat(task.id,token(task)),true);
});
