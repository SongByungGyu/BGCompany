import test from "node:test";
import assert from "node:assert/strict";
import {
  evaluateStockBlogSchedulerRetry,
  isStockReferencePreflightFailure,
} from "./stock-blog-scheduler-policy.ts";

test("시장 참고자료 사전검증 실패만 재시도 가능한 데이터 실패로 분류한다", () => {
  assert.equal(
    isStockReferencePreflightFailure(
      "STOCK_REFERENCE_PREFLIGHT_BLOCKED: needs_data · KOSPI 강세/약세 업종",
    ),
    true,
  );
  assert.equal(
    isStockReferencePreflightFailure("네이버 이미지 업로드 실패"),
    false,
  );
});

test("자동발행 사전검증 실패는 설정된 지연 뒤 한 번 재시도한다", () => {
  const decision = evaluateStockBlogSchedulerRetry({
    exists: true,
    status: "failed",
    previousAttempt: 1,
    elapsedMs: 10 * 60 * 1000,
    autoPublish: true,
    autoPublishRetryLimit: 1,
    maxRetries: 3,
    retryDelayMinutes: 10,
  });

  assert.deepEqual(decision, { allowed: true, attempt: 2 });
});

test("자동발행 재시도 한도에 도달하면 추가 실행을 막는다", () => {
  const decision = evaluateStockBlogSchedulerRetry({
    exists: true,
    status: "failed",
    previousAttempt: 2,
    elapsedMs: 60 * 60 * 1000,
    autoPublish: true,
    autoPublishRetryLimit: 1,
    maxRetries: 3,
    retryDelayMinutes: 10,
  });

  assert.equal(decision.allowed, false);
  assert.equal(decision.attempt, 2);
  assert.match(decision.reason ?? "", /재시도 한도 1회/);
});

test("재시도 지연이 지나기 전에는 남은 대기 시간을 반환한다", () => {
  const decision = evaluateStockBlogSchedulerRetry({
    exists: true,
    status: "failed",
    previousAttempt: 1,
    elapsedMs: 4 * 60 * 1000,
    autoPublish: true,
    autoPublishRetryLimit: 1,
    maxRetries: 3,
    retryDelayMinutes: 10,
  });

  assert.equal(decision.allowed, false);
  assert.match(decision.reason ?? "", /약 6분 후 가능/);
});
