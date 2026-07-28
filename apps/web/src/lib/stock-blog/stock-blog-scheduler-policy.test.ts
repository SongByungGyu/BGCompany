import test from "node:test";
import assert from "node:assert/strict";
import {
  evaluateStockBlogSchedulerRetry,
  isStockReferencePreflightFailure,
  shouldClearRecoverablePipelineCircuitBreaker,
  shouldClearReferencePreflightCircuitBreaker,
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

test("자동발행 재시도가 0이어도 참고자료 사전검증 실패는 한 번 재시도한다", () => {
  const decision = evaluateStockBlogSchedulerRetry({
    exists: true,
    status: "failed",
    previousAttempt: 1,
    elapsedMs: 10 * 60 * 1000,
    autoPublish: true,
    autoPublishRetryLimit: 0,
    maxRetries: 3,
    retryDelayMinutes: 10,
    referencePreflightFailure: true,
  });

  assert.deepEqual(decision, { allowed: true, attempt: 2 });
});

test("이전 날짜 참고자료 차단기는 해제하지만 실제 발행 실패 차단기는 유지한다", () => {
  assert.equal(
    shouldClearReferencePreflightCircuitBreaker({
      active: true,
      reason: "STOCK_REFERENCE_PREFLIGHT_BLOCKED: needs_data · KOSPI 강세/약세 업종",
    }),
    true,
  );
  assert.equal(
    shouldClearReferencePreflightCircuitBreaker({
      active: true,
      reason: "네이버 이미지 업로드 실패",
    }),
    false,
  );
});

test("품질 실패 차단기는 해제하지만 실제 네이버 발행 실패 차단기는 유지한다", () => {
  assert.equal(
    shouldClearRecoverablePipelineCircuitBreaker({
      active: true,
      status: "quality_failed",
      reason: "본문 분량 부족",
    }),
    true,
  );
  assert.equal(
    shouldClearRecoverablePipelineCircuitBreaker({
      active: true,
      status: "publish_failed",
      reason: "네이버 최종 발행 실패",
    }),
    false,
  );
});

test("기존 partial 품질 실패도 자동발행 재시도가 0이어도 한 번 재시도한다", () => {
  assert.deepEqual(
    evaluateStockBlogSchedulerRetry({
      exists: true,
      status: "partial_failed",
      previousAttempt: 1,
      elapsedMs: 10 * 60 * 1000,
      autoPublish: true,
      autoPublishRetryLimit: 0,
      maxRetries: 3,
      retryDelayMinutes: 10,
      retryableGenerationFailure: true,
    }),
    { allowed: true, attempt: 2 },
  );
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
