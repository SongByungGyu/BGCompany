import test from "node:test";
import assert from "node:assert/strict";
import {
  canRequeueNaverAuthHoldJob,
  evaluateNaverSessionReadyProbe,
  evaluateNaverAuthHold,
  getNaverAuthHoldCooldownMs,
  isNaverAuthHoldStatus,
  isNaverAuthHoldProgressAllowed,
  isNaverSessionReadyProgress,
  parseNaverAuthHoldSnapshot,
} from "./naver-auth-hold-policy.ts";

const now = Date.parse("2026-09-04T00:00:00.000Z");

function snapshot(retryAfter = "2026-09-04T00:05:00.000Z") {
  return parseNaverAuthHoldSnapshot({
    active: true,
    jobId: "job-held",
    status: "login_required",
    heldAt: "2026-09-04T00:00:00.000Z",
    retryAfter,
    probeCount: 1,
  });
}

test("로그인·캡차·보안확인만 계정 인증 hold로 분류한다", () => {
  for (const status of ["login_required", "captcha_required", "security_check_required"]) {
    assert.equal(isNaverAuthHoldStatus(status), true);
  }
  assert.equal(isNaverAuthHoldStatus("publish_failed"), false);
});

test("인증 hold cooldown 동안 어떤 job도 반환하지 않는다", () => {
  assert.deepEqual(evaluateNaverAuthHold({
    snapshot: snapshot(),
    nowMs: now,
    heldJob: { id: "job-held", status: "queued", publishAttemptCount: 0, claimable: true },
  }), { action: "wait", reason: "AUTH_HOLD_COOLDOWN" });
});

test("cooldown 후에도 held job만 probe한다", () => {
  assert.deepEqual(evaluateNaverAuthHold({
    snapshot: snapshot("2026-09-03T23:59:59.000Z"),
    nowMs: now,
    heldJob: { id: "job-held", status: "queued", publishAttemptCount: 0, claimable: true },
  }), { action: "probe", jobId: "job-held" });
});

test("held job이 실행 중이면 다음 job 대신 계속 기다린다", () => {
  assert.deepEqual(evaluateNaverAuthHold({
    snapshot: snapshot("2026-09-03T23:59:59.000Z"),
    nowMs: now,
    heldJob: { id: "job-held", status: "in_progress", publishAttemptCount: 0, claimable: false },
  }), { action: "wait", reason: "AUTH_HOLD_JOB_ALREADY_CLAIMED" });
});

test("held job이 취소되거나 유실되면 hold를 안전하게 해제한다", () => {
  assert.deepEqual(evaluateNaverAuthHold({ snapshot: snapshot(), nowMs: now, heldJob: null }), {
    action: "clear",
    reason: "AUTH_HOLD_JOB_MISSING",
  });
  assert.deepEqual(evaluateNaverAuthHold({
    snapshot: snapshot(),
    nowMs: now,
    heldJob: { id: "job-held", status: "cancelled", publishAttemptCount: 0, claimable: false },
  }), { action: "clear", reason: "AUTH_HOLD_JOB_TERMINAL:cancelled" });
});

test("발행 시도 이후 job은 인증 재큐잉하지 않는다", () => {
  assert.equal(canRequeueNaverAuthHoldJob(0), true);
  assert.equal(canRequeueNaverAuthHoldJob(1), false);
  assert.deepEqual(evaluateNaverAuthHold({
    snapshot: snapshot("2026-09-03T23:59:59.000Z"),
    nowMs: now,
    heldJob: { id: "job-held", status: "queued", publishAttemptCount: 1, claimable: true },
  }), { action: "wait", reason: "AUTH_HOLD_AFTER_PUBLISH_ATTEMPT_REQUIRES_REVIEW" });
});

test("NAVER_SESSION_READY 진행 신호만 인증 성공으로 인정한다", () => {
  assert.equal(isNaverSessionReadyProgress({ status: "in_progress", errorCode: "NAVER_SESSION_READY" }), true);
  assert.equal(isNaverSessionReadyProgress({ status: "queued", errorCode: "NAVER_SESSION_READY" }), false);
});

test("인증 hold가 풀리기 전에는 신규 공개 진행만 막고 heartbeat와 결과 기록은 허용한다", () => {
  const base = { active: true, holdJobId: "job-held", jobId: "job-held" };
  assert.equal(isNaverAuthHoldProgressAllowed({ ...base, currentStatus: "claimed", nextStatus: "in_progress" }), true);
  assert.equal(isNaverAuthHoldProgressAllowed({ ...base, currentStatus: "in_progress", nextStatus: "in_progress" }), true);
  assert.equal(isNaverAuthHoldProgressAllowed({ ...base, currentStatus: "in_progress", nextStatus: "image_uploading" }), false);
  assert.equal(isNaverAuthHoldProgressAllowed({ ...base, currentStatus: "publish_ready", nextStatus: "publishing" }), false);
  assert.equal(isNaverAuthHoldProgressAllowed({ ...base, jobId: "job-other", currentStatus: "claimed", nextStatus: "in_progress" }), false);
  assert.equal(isNaverAuthHoldProgressAllowed({ ...base, jobId: "job-other", currentStatus: "in_progress", nextStatus: "in_progress" }), true);
  assert.equal(isNaverAuthHoldProgressAllowed({ ...base, jobId: "job-other", currentStatus: "publishing", nextStatus: "published" }), true);
  assert.equal(isNaverAuthHoldProgressAllowed({ ...base, jobId: "job-other", currentStatus: "publishing", nextStatus: "publish_failed" }), true);
  assert.equal(isNaverAuthHoldProgressAllowed({ ...base, jobId: "job-other", currentStatus: "in_progress", nextStatus: "failed" }), true);
  assert.equal(isNaverAuthHoldProgressAllowed({ ...base, active: false, currentStatus: "in_progress", nextStatus: "image_uploading" }), true);
});

test("인증 hold는 간격을 둔 두 번의 ready 확인 뒤에만 해제한다", () => {
  const lease = "2026-09-04T00:00:00.000Z";
  const first = evaluateNaverSessionReadyProbe({
    previousCount: 0,
    previousAt: null,
    previousLeaseClaimedAt: null,
    leaseClaimedAt: lease,
    nowMs: now,
  });
  assert.deepEqual(first, { ready: false, nextCount: 1 });
  assert.deepEqual(evaluateNaverSessionReadyProbe({
    previousCount: first.nextCount,
    previousAt: new Date(now).toISOString(),
    previousLeaseClaimedAt: lease,
    leaseClaimedAt: lease,
    nowMs: now + 500,
  }), { ready: false, nextCount: 1 });
  assert.deepEqual(evaluateNaverSessionReadyProbe({
    previousCount: first.nextCount,
    previousAt: new Date(now).toISOString(),
    previousLeaseClaimedAt: lease,
    leaseClaimedAt: lease,
    nowMs: now + 1_000,
  }), { ready: true, nextCount: 2 });
  const newLeaseFirst = evaluateNaverSessionReadyProbe({
    previousCount: first.nextCount,
    previousAt: new Date(now).toISOString(),
    previousLeaseClaimedAt: lease,
    leaseClaimedAt: "2026-09-04T00:01:00.000Z",
    nowMs: now + 2_000,
  });
  assert.deepEqual(newLeaseFirst, { ready: false, nextCount: 1 });
  assert.deepEqual(evaluateNaverSessionReadyProbe({
    previousCount: newLeaseFirst.nextCount,
    previousAt: new Date(now + 2_000).toISOString(),
    previousLeaseClaimedAt: "2026-09-04T00:01:00.000Z",
    leaseClaimedAt: "2026-09-04T00:01:00.000Z",
    nowMs: now + 3_000,
  }), { ready: true, nextCount: 2 });
});

test("인증 hold cooldown은 30초에서 1시간 사이로 제한한다", () => {
  assert.equal(getNaverAuthHoldCooldownMs("1"), 30_000);
  assert.equal(getNaverAuthHoldCooldownMs("9999"), 3_600_000);
  assert.equal(getNaverAuthHoldCooldownMs("invalid"), 300_000);
});
