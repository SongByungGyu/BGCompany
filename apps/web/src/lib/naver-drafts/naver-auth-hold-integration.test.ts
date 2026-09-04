import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

const jobsSource = readFileSync(fileURLToPath(new URL("./naver-draft-jobs.ts", import.meta.url)), "utf8");
const writerSource = readFileSync(
  fileURLToPath(new URL("../../../../../tools/naver-draft-agent/src/naver-writer.ts", import.meta.url)),
  "utf8",
);
const schedulerSource = readFileSync(
  fileURLToPath(new URL("../stock-blog/stock-blog-scheduler.ts", import.meta.url)),
  "utf8",
);

test("auth failure requeues the same claimed job and records a separate hold", () => {
  assert.match(jobsSource, /status:\s*"queued",[\s\S]*?claimedBy:\s*null,[\s\S]*?claimedAt:\s*null/);
  assert.match(jobsSource, /id:\s*NAVER_AUTH_HOLD_EVENT_ID/);
  assert.match(jobsSource, /publishKey:\s*job\.publishKey/);
  assert.match(jobsSource, /NAVER_AUTH_HOLD_AGENT_MISMATCH/);
});

test("an active hold gates claims to the held probe job", () => {
  assert.match(jobsSource, /decision\.action !== "probe" \|\| decision\.jobId !== jobId/);
  assert.match(jobsSource, /clearNaverAuthHold\(tx, authHold\.jobId, decision\.reason\)/);
});

test("writer only signals session ready after the auth/security page checks", () => {
  const authCheck = writerSource.indexOf("NAVER_LOGIN_OR_SECURITY_REQUIRED");
  const readySignal = writerSource.indexOf("NAVER_SESSION_READY");
  assert.ok(authCheck >= 0);
  assert.ok(readySignal > authCheck);
});

test("publish breaker pauses leasing without suppressing content and queue creation", () => {
  const createStart = jobsSource.indexOf("export async function createNaverDraftJobFromPipeline");
  const cancelStart = jobsSource.indexOf("export async function cancelNaverDraftJob", createStart);
  const createSource = jobsSource.slice(createStart, cancelStart);
  assert.doesNotMatch(createSource, /NAVER_PUBLISH_CIRCUIT_BREAKER_ACTIVE/);
  assert.doesNotMatch(schedulerSource, /if \(circuit\.active\)[\s\S]{0,300}status:\s*"skipped"/);
  assert.match(jobsSource, /publishCircuit\.active \? \{ allowPublish: false \}/);
});

test("breaker keeps publish_ready non-terminal and late scheduled jobs expire explicitly", () => {
  assert.match(jobsSource, /if \(circuitPayload\.active === true\) \{\s*return job;/);
  assert.match(jobsSource, /errorCode:\s*"NAVER_SCHEDULE_EXPIRED"/);
});
