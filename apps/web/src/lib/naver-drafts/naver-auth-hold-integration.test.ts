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
const claimRouteSource = readFileSync(
  fileURLToPath(new URL("../../app/api/local-agents/naver-drafts/[jobId]/claim/route.ts", import.meta.url)),
  "utf8",
);

test("auth failure requeues the same claimed job and records a separate hold", () => {
  assert.match(jobsSource, /status:\s*"queued",[\s\S]*?claimedBy:\s*null,[\s\S]*?claimedAt:\s*null/);
  assert.match(jobsSource, /id:\s*NAVER_AUTH_HOLD_EVENT_ID/);
  assert.match(jobsSource, /publishKey:\s*job\.publishKey/);
  assert.match(jobsSource, /NAVER_DRAFT_LEASE_AGENT_MISMATCH/);
  assert.match(jobsSource, /leaseClaimedAt/);
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
  assert.match(jobsSource, /autoPublishLeaseBlocked \? \{ allowPublish: false \}/);
  assert.match(jobsSource, /status: "publishing_unknown"|"publishing_unknown"/);
});

test("breaker keeps publish_ready non-terminal and late scheduled jobs expire explicitly", () => {
  assert.match(jobsSource, /if \(circuitPayload\.active === true\)[\s\S]{0,500}status: "publish_ready" as const/);
  assert.match(jobsSource, /NAVER_PUBLISH_CIRCUIT_BREAKER_ACTIVE/);
  assert.match(jobsSource, /errorCode:\s*"NAVER_SCHEDULE_EXPIRED"/);
});

test("publish and terminal reports use ownership CAS and stale publishing blocks later leases", () => {
  assert.match(jobsSource, /function assertOwnedNaverLease/);
  assert.match(jobsSource, /claimedAt:\s*leaseClaimedAt/);
  assert.match(jobsSource, /updatedAt:\s*job\.updatedAt/);
  assert.match(jobsSource, /isNaverDraftTerminalStatus\(current\.status\)/);
  assert.match(jobsSource, /if \(current\.status === "publishing"\) return current/);
  assert.match(jobsSource, /activePublishing/);
  assert.match(jobsSource, /activateStalePublishingCircuitBreaker/);
  assert.match(claimRouteSource, /leaseProtocolVersion !== 2/);
  assert.match(claimRouteSource, /NAVER_DRAFT_LEASE_PROTOCOL_UPGRADE_REQUIRED/);
});

test("authentication ready requires two server probes and two writer checks", () => {
  assert.match(jobsSource, /evaluateNaverSessionReadyProbe/);
  assert.match(jobsSource, /NAVER_SESSION_READY_CONFIRMED_TWICE/);
  assert.match(jobsSource, /readyProbeLeaseClaimedAt/);
  assert.match(writerSource, /for \(let readyProbe = 0; readyProbe < 2; readyProbe \+= 1\)/);
});

test("publish gate precedes every UI publish click and ambiguous page links cannot confirm success", () => {
  const runSource = writerSource.slice(writerSource.indexOf("export async function runNaverWriter"));
  assert.ok(runSource.indexOf("context.beginPublish?.()") < runSource.indexOf("await prepareNaverPublishDialog("));
  assert.doesNotMatch(writerSource, /locator\('a\[href\*="blog\.naver\.com"\]\[href\*="logNo"\]/);
  assert.match(jobsSource, /NAVER_PUBLISHED_POST_ID_ALREADY_RECORDED/);
});
