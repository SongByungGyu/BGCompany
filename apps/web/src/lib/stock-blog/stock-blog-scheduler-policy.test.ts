import test from "node:test";
import assert from "node:assert/strict";
import {
  evaluateStockBlogRecoveryDate,
  evaluateStockBlogSchedulerRetry,
  isNaverDraftAssemblyQualityFailure,
  isStockContentQualityFailure,
  isStockReferencePreflightFailure,
  shouldClearRecoverablePipelineCircuitBreaker,
  shouldClearReferencePreflightCircuitBreaker,
} from "./stock-blog-scheduler-policy.ts";

test("지난 7일 안의 올바른 요일 일정만 복구 대상으로 허용한다", () => {
  assert.deepEqual(evaluateStockBlogRecoveryDate({
    scheduledDate: "2026-08-01",
    todayDate: "2026-08-02",
    weekdays: [6],
  }), { allowed: true });
  assert.equal(evaluateStockBlogRecoveryDate({
    scheduledDate: "2026-08-02",
    todayDate: "2026-08-02",
    weekdays: [6],
  }).allowed, false);
  assert.equal(evaluateStockBlogRecoveryDate({
    scheduledDate: "2026-07-18",
    todayDate: "2026-08-02",
    weekdays: [6],
  }).allowed, false);
});

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

test("네이버 작업 조립 단계의 품질 실패도 콘텐츠 품질 복구 대상으로 분류한다", () => {
  assert.equal(
    isStockContentQualityFailure("NAVER_DRAFT_QUALITY_FAILED: 본문 분량 1,800~2,800자"),
    true,
  );
  assert.equal(isStockContentQualityFailure("NAVER_PUBLISH_FAILED: 발행 버튼 오류"), false);
  assert.equal(
    isNaverDraftAssemblyQualityFailure(
      "STOCK_CONTENT_QUALITY_FAILED: NAVER_DRAFT_QUALITY_FAILED: 본문 분량 초과",
    ),
    true,
  );
  assert.equal(isNaverDraftAssemblyQualityFailure("NAVER_PUBLISH_FAILED: 발행 버튼 오류"), false);
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

test("인증된 수동 복구는 품질 실패 재시도 한도 뒤에도 한 번 더 실행한다", () => {
  const decision = evaluateStockBlogSchedulerRetry({
    exists: true,
    status: "failed",
    previousAttempt: 3,
    elapsedMs: 60 * 60 * 1000,
    autoPublish: true,
    autoPublishRetryLimit: 2,
    maxRetries: 3,
    retryDelayMinutes: 10,
    retryableGenerationFailure: true,
    manualRecovery: true,
  });

  assert.deepEqual(decision, { allowed: true, attempt: 4 });
});

test("인증된 수동 복구의 추가 실행도 한 번으로 제한한다", () => {
  const decision = evaluateStockBlogSchedulerRetry({
    exists: true,
    status: "failed",
    previousAttempt: 4,
    elapsedMs: 60 * 60 * 1000,
    autoPublish: true,
    autoPublishRetryLimit: 2,
    maxRetries: 3,
    retryDelayMinutes: 10,
    retryableGenerationFailure: true,
    manualRecovery: true,
  });

  assert.equal(decision.allowed, false);
});

test("인증된 수동 복구는 운영 복구 상한 안에서 연속된 품질 수정 뒤 다시 실행한다", () => {
  const decision = evaluateStockBlogSchedulerRetry({
    exists: true,
    status: "failed",
    previousAttempt: 4,
    elapsedMs: 60 * 60 * 1000,
    autoPublish: true,
    autoPublishRetryLimit: 2,
    maxRetries: 12,
    retryDelayMinutes: 10,
    retryableGenerationFailure: true,
    manualRecovery: true,
  });

  assert.deepEqual(decision, { allowed: true, attempt: 5 });
});

test("참고자료 사전검증 시도 횟수가 누적돼도 생성 품질 수동 복구를 별도로 허용한다", () => {
  const decision = evaluateStockBlogSchedulerRetry({
    exists: true,
    status: "failed",
    previousAttempt: 13,
    elapsedMs: 60 * 60 * 1000,
    autoPublish: true,
    autoPublishRetryLimit: 2,
    maxRetries: 12,
    retryDelayMinutes: 10,
    retryableGenerationFailure: true,
    manualRecovery: true,
  });

  assert.deepEqual(decision, { allowed: true, attempt: 14 });
});

test("인증된 수동 복구도 실제 발행 실패의 재시도 한도는 우회하지 않는다", () => {
  const decision = evaluateStockBlogSchedulerRetry({
    exists: true,
    status: "failed",
    previousAttempt: 3,
    elapsedMs: 60 * 60 * 1000,
    autoPublish: true,
    autoPublishRetryLimit: 2,
    maxRetries: 3,
    retryDelayMinutes: 10,
    manualRecovery: true,
  });

  assert.equal(decision.allowed, false);
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
  assert.match(decision.reason ?? "", /약 5분 후 가능/);
});

test("Hermes 용량 대기는 시도 횟수를 소진하지 않고 다시 실행한다", () => {
  const decision = evaluateStockBlogSchedulerRetry({
    exists: true,
    status: "deferred",
    previousAttempt: 3,
    elapsedMs: 10 * 60 * 1000,
    autoPublish: true,
    autoPublishRetryLimit: 2,
    maxRetries: 3,
    retryDelayMinutes: 10,
  });

  assert.deepEqual(decision, { allowed: true, attempt: 3 });
});

test("중단된 running 실행은 30분 뒤 같은 시도로 복구한다", () => {
  const waiting = evaluateStockBlogSchedulerRetry({
    exists: true,
    status: "running",
    previousAttempt: 2,
    elapsedMs: 20 * 60 * 1000,
    autoPublish: true,
    autoPublishRetryLimit: 2,
    maxRetries: 3,
    retryDelayMinutes: 10,
  });
  const recovered = evaluateStockBlogSchedulerRetry({
    exists: true,
    status: "running",
    previousAttempt: 2,
    elapsedMs: 30 * 60 * 1000,
    autoPublish: true,
    autoPublishRetryLimit: 2,
    maxRetries: 3,
    retryDelayMinutes: 10,
  });

  assert.equal(waiting.allowed, false);
  assert.deepEqual(recovered, { allowed: true, attempt: 2 });
});
