import test from "node:test";
import assert from "node:assert/strict";
import {
  createEmptyStockBlogRetryV2State,
  evaluateStockBlogRetryV2Claim,
  evaluateStockBlogPhaseBudget,
  evaluateStockBlogRecoveryDate,
  evaluateStockBlogSchedulerRetry,
  isNaverDraftAssemblyQualityFailure,
  isStockContentQualityFailure,
  isStockReferencePreflightFailure,
  parseStockBlogRetryV2,
  reopenStockBlogRetryV2ContentGeneration,
  requestStockBlogRetryV2ReferenceRefresh,
  settleStockBlogRetryV2Claim,
  STOCK_BLOG_RETRY_PHASE_LIMITS,
  STOCK_BLOG_RETRY_PHASE_LEASE_MS,
  shouldClearRecoverablePipelineCircuitBreaker,
  shouldClearReferencePreflightCircuitBreaker,
} from "./stock-blog-scheduler-policy.ts";

test("기존 retryV2에 참고자료 갱신 필드가 없어도 false로 호환한다", () => {
  const parsed = parseStockBlogRetryV2({
    payload: {
      retryV2: {
        version: 2,
        attempts: { reference_preflight: 1, content_generation: 0, draft_assembly: 0 },
        completed: { reference_preflight: true, content_generation: false, draft_assembly: false },
        lease: null,
      },
    },
  });

  assert.equal(parsed.ok, true);
  if (parsed.ok) assert.equal(parsed.state.referenceRefreshRequired, false);
});

test("참고자료 갱신 필드가 boolean이 아니면 fail-closed 한다", () => {
  const parsed = parseStockBlogRetryV2({
    payload: {
      retryV2: {
        version: 2,
        attempts: { reference_preflight: 1, content_generation: 0, draft_assembly: 0 },
        completed: { reference_preflight: true, content_generation: false, draft_assembly: false },
        referenceRefreshRequired: "yes",
        lease: null,
      },
    },
  });

  assert.equal(parsed.ok, false);
});

test("retryV2의 필수 필드가 손상되면 기존 숫자로 추측하지 않고 닫힌 상태로 중단한다", () => {
  const parsed = parseStockBlogRetryV2({
    payload: {
      retryV2: {
        version: 2,
        attempts: { reference_preflight: 1, content_generation: "1", draft_assembly: 0 },
        completed: { reference_preflight: true, content_generation: false, draft_assembly: false },
        lease: null,
      },
      attempt: 1,
    },
  });

  assert.equal(parsed.ok, false);
  if (!parsed.ok) assert.match(parsed.reason, /손상/);
});

test("레거시 품질 실패 횟수는 보수적으로 생성 단계에 이관한다", () => {
  const parsed = parseStockBlogRetryV2({
    payload: {
      status: "failed",
      attempt: 3,
      reason: "STOCK_CONTENT_QUALITY_FAILED: QA 차단",
      pipelineId: "content-pipeline-old",
    },
  });

  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.migratedFromLegacy, true);
  assert.equal(parsed.state.attempts.content_generation, 3);
  assert.equal(parsed.state.completed.reference_preflight, true);
  assert.equal(parsed.state.completed.content_generation, false);
});

test("레거시 네이버 조립 실패는 생성 재시도가 아니라 조립 단계만 이관한다", () => {
  const parsed = parseStockBlogRetryV2({
    payload: {
      status: "partial_failed",
      attempt: 7,
      reason: "STOCK_CONTENT_QUALITY_FAILED: NAVER_DRAFT_QUALITY_FAILED: 본문 꼬리 중복",
      pipelineId: "content-pipeline-good",
    },
  });

  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.state.completed.reference_preflight, true);
  assert.equal(parsed.state.completed.content_generation, true);
  assert.equal(parsed.state.completed.draft_assembly, false);
  assert.equal(parsed.state.attempts.content_generation, 1);
  assert.equal(parsed.state.attempts.draft_assembly, 1);
});

test("레거시 running 이벤트는 기존 15분 복구 창을 유지한다", () => {
  const parsed = parseStockBlogRetryV2({
    payload: { status: "running", attempt: 1 },
    eventTimestamp: new Date("2026-09-04T00:00:00.000Z"),
  });

  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.state.lease?.claimedAt, "2026-09-04T00:00:00.000Z");
  assert.equal(parsed.state.lease?.expiresAt, "2026-09-04T00:15:00.000Z");
});

test("선행 단계 없이 후행 단계 시도나 완료가 기록된 retryV2는 거부한다", () => {
  const parsed = parseStockBlogRetryV2({
    payload: {
      retryV2: {
        version: 2,
        attempts: { reference_preflight: 0, content_generation: 1, draft_assembly: 0 },
        completed: { reference_preflight: false, content_generation: false, draft_assembly: false },
        lease: null,
      },
    },
  });
  assert.equal(parsed.ok, false);
});

test("완료 횟수와 lease 선행조건이 모순된 retryV2는 모두 fail-closed 한다", () => {
  const malformedStates = [
    {
      version: 2,
      attempts: { reference_preflight: 0, content_generation: 0, draft_assembly: 0 },
      completed: { reference_preflight: true, content_generation: false, draft_assembly: false },
      lease: null,
    },
    {
      version: 2,
      attempts: { reference_preflight: 0, content_generation: 1, draft_assembly: 0 },
      completed: { reference_preflight: false, content_generation: false, draft_assembly: false },
      lease: {
        phase: "content_generation",
        attempt: 1,
        token: "worker-token",
        claimedAt: "2026-09-04T00:00:00.000Z",
        expiresAt: "2026-09-04T01:30:00.000Z",
      },
    },
    {
      version: 2,
      attempts: { reference_preflight: 1, content_generation: 0, draft_assembly: 0 },
      completed: { reference_preflight: true, content_generation: false, draft_assembly: false },
      lease: {
        phase: "reference_preflight",
        attempt: 1,
        token: "worker-token",
        claimedAt: "2026-09-04T00:00:00.000Z",
        expiresAt: "2026-09-04T01:30:00.000Z",
      },
    },
  ];

  for (const retryV2 of malformedStates) {
    assert.equal(parseStockBlogRetryV2({ payload: { retryV2 } }).ok, false);
  }
});

test("먼저 저장된 활성 lease는 뒤따른 실행의 중복 claim을 막는다", () => {
  const now = new Date("2026-09-04T00:00:00.000Z");
  const first = evaluateStockBlogRetryV2Claim({
    state: createEmptyStockBlogRetryV2State(),
    phase: "reference_preflight",
    now,
    token: "worker-a-token",
  });
  assert.equal(first.action, "claim");
  if (first.action !== "claim") return;

  const second = evaluateStockBlogRetryV2Claim({
    state: first.state,
    phase: "reference_preflight",
    now: new Date(now.getTime() + 60_000),
    token: "worker-b-token",
  });
  assert.equal(second.action, "blocked");
  assert.equal(second.state.attempts.reference_preflight, 1);
});

test("선행 단계가 완료되지 않은 후행 단계는 seed 상태에서도 claim하지 않는다", () => {
  const decision = evaluateStockBlogRetryV2Claim({
    state: createEmptyStockBlogRetryV2State(),
    phase: "draft_assembly",
    now: new Date("2026-09-04T00:00:00.000Z"),
    token: "worker-token",
  });
  assert.equal(decision.action, "blocked");
  assert.equal(decision.state.attempts.draft_assembly, 0);
});

test("중단된 실행의 lease가 만료돼도 이미 잡은 시도는 소모되며 상한을 우회하지 않는다", () => {
  const state = createEmptyStockBlogRetryV2State();
  state.attempts.content_generation = 2;
  state.completed.reference_preflight = true;
  state.lease = {
    phase: "content_generation",
    attempt: 2,
    token: "crashed-worker",
    claimedAt: "2026-09-04T00:00:00.000Z",
    expiresAt: "2026-09-04T00:20:00.000Z",
  };

  const decision = evaluateStockBlogRetryV2Claim({
    state,
    phase: "content_generation",
    now: new Date("2026-09-04T00:21:00.000Z"),
    token: "replacement-worker",
  });
  assert.equal(decision.action, "blocked");
  if (decision.action === "blocked") assert.match(decision.reason, /2회/);
});

test("인증된 수동 복구는 본문 생성 1회만 추가하고 누적 횟수로 반복 우회를 막는다", () => {
  const state = createEmptyStockBlogRetryV2State();
  state.attempts.reference_preflight = 1;
  state.completed.reference_preflight = true;
  state.attempts.content_generation = 2;

  const automatic = evaluateStockBlogRetryV2Claim({
    state,
    phase: "content_generation",
    now: new Date("2026-09-04T00:00:00.000Z"),
    token: "automatic-token",
  });
  assert.equal(automatic.action, "blocked");

  const manual = evaluateStockBlogRetryV2Claim({
    state,
    phase: "content_generation",
    now: new Date("2026-09-04T00:00:00.000Z"),
    token: "manual-token",
    maxAttempts: STOCK_BLOG_RETRY_PHASE_LIMITS.content_generation + 1,
  });
  assert.equal(manual.action, "claim");
  if (manual.action !== "claim") return;
  const failed = settleStockBlogRetryV2Claim({
    state: manual.state,
    token: manual.lease.token,
    succeeded: false,
  });
  assert.ok(failed);
  const repeated = evaluateStockBlogRetryV2Claim({
    state: failed!,
    phase: "content_generation",
    now: new Date("2026-09-04T00:01:00.000Z"),
    token: "second-manual-token",
    maxAttempts: STOCK_BLOG_RETRY_PHASE_LIMITS.content_generation + 1,
  });
  assert.equal(repeated.action, "blocked");
});

test("Hermes 용량 대기는 claim을 되돌려 단계 시도를 소모하지 않는다", () => {
  const claimed = evaluateStockBlogRetryV2Claim({
    state: createEmptyStockBlogRetryV2State(),
    phase: "reference_preflight",
    now: new Date("2026-09-04T00:00:00.000Z"),
    token: "capacity-token",
  });
  assert.equal(claimed.action, "claim");
  if (claimed.action !== "claim") return;
  const released = settleStockBlogRetryV2Claim({
    state: claimed.state,
    token: claimed.lease.token,
    succeeded: false,
    consumeAttempt: false,
  });
  assert.equal(released?.attempts.reference_preflight, 0);
  assert.equal(released?.lease, null);
});

test("성공한 단계는 완료 처리되어 같은 외부 호출을 다시 claim하지 않는다", () => {
  const claimed = evaluateStockBlogRetryV2Claim({
    state: createEmptyStockBlogRetryV2State(),
    phase: "reference_preflight",
    now: new Date("2026-09-04T00:00:00.000Z"),
    token: "success-token",
  });
  assert.equal(claimed.action, "claim");
  if (claimed.action !== "claim") return;
  const settled = settleStockBlogRetryV2Claim({
    state: claimed.state,
    token: claimed.lease.token,
    succeeded: true,
  });
  assert.ok(settled);
  const replay = evaluateStockBlogRetryV2Claim({
    state: settled!,
    phase: "reference_preflight",
    now: new Date("2026-09-04T00:01:00.000Z"),
    token: "replay-token",
  });
  assert.equal(replay.action, "completed");
});

test("참고자료 갱신은 과거 완료 이력과 생성 시도는 보존하고 후행 checkpoint만 다시 연다", () => {
  const state = createEmptyStockBlogRetryV2State();
  state.attempts.reference_preflight = 1;
  state.completed.reference_preflight = true;
  state.attempts.content_generation = 1;
  state.completed.content_generation = true;
  state.attempts.draft_assembly = 1;

  const refreshed = requestStockBlogRetryV2ReferenceRefresh(state);
  assert.ok(refreshed);
  assert.equal(refreshed?.referenceRefreshRequired, true);
  assert.equal(refreshed?.completed.reference_preflight, true);
  assert.equal(refreshed?.completed.content_generation, false);
  assert.equal(refreshed?.attempts.content_generation, 1);
  assert.equal(refreshed?.attempts.draft_assembly, 0);
  assert.equal(parseStockBlogRetryV2({ payload: { retryV2: refreshed } }).ok, true);
});

test("참고자료 갱신 중에는 후행 단계를 막고 이미 완료된 참고자료 단계만 다시 claim한다", () => {
  const state = createEmptyStockBlogRetryV2State();
  state.attempts.reference_preflight = 1;
  state.completed.reference_preflight = true;
  state.referenceRefreshRequired = true;

  const generation = evaluateStockBlogRetryV2Claim({
    state,
    phase: "content_generation",
    now: new Date("2026-09-04T00:00:00.000Z"),
    token: "generation-token",
  });
  assert.equal(generation.action, "blocked");

  const reference = evaluateStockBlogRetryV2Claim({
    state,
    phase: "reference_preflight",
    now: new Date("2026-09-04T00:00:00.000Z"),
    token: "reference-token",
  });
  assert.equal(reference.action, "claim");
  if (reference.action !== "claim") return;
  const settled = settleStockBlogRetryV2Claim({
    state: reference.state,
    token: reference.lease.token,
    succeeded: true,
  });
  assert.equal(settled?.referenceRefreshRequired, false);
  assert.equal(settled?.completed.reference_preflight, true);
});

test("단계별 lease는 참고자료 20분·본문 생성 90분·조립 10분을 사용한다", () => {
  const now = new Date("2026-09-04T00:00:00.000Z");
  for (const phase of ["reference_preflight", "content_generation", "draft_assembly"] as const) {
    const state = createEmptyStockBlogRetryV2State();
    if (phase !== "reference_preflight") {
      state.attempts.reference_preflight = 1;
      state.completed.reference_preflight = true;
    }
    if (phase === "draft_assembly") {
      state.attempts.content_generation = 1;
      state.completed.content_generation = true;
    }
    const claim = evaluateStockBlogRetryV2Claim({ state, phase, now, token: `${phase}-token` });
    assert.equal(claim.action, "claim");
    if (claim.action === "claim") {
      assert.equal(
        Date.parse(claim.lease.expiresAt) - now.getTime(),
        STOCK_BLOG_RETRY_PHASE_LEASE_MS[phase],
      );
    }
  }
});

test("네이버 본문 품질 실패는 조립 시도를 되돌린 뒤 생성 checkpoint만 다시 연다", () => {
  const state = createEmptyStockBlogRetryV2State();
  state.attempts.reference_preflight = 1;
  state.completed.reference_preflight = true;
  state.attempts.content_generation = 1;
  state.completed.content_generation = true;
  const draftClaim = evaluateStockBlogRetryV2Claim({
    state,
    phase: "draft_assembly",
    now: new Date("2026-09-04T00:00:00.000Z"),
    token: "draft-worker-token",
  });
  assert.equal(draftClaim.action, "claim");
  if (draftClaim.action !== "claim") return;
  const released = settleStockBlogRetryV2Claim({
    state: draftClaim.state,
    token: draftClaim.lease.token,
    succeeded: false,
    consumeAttempt: false,
  });
  assert.ok(released);
  const reopened = reopenStockBlogRetryV2ContentGeneration(released!);
  assert.ok(reopened);
  assert.equal(reopened?.attempts.content_generation, 1);
  assert.equal(reopened?.completed.content_generation, false);
  assert.equal(reopened?.attempts.draft_assembly, 0);
});

test("이전 조립 실패 이력이 있어도 새 본문 생성으로 전환할 때 조립 예산을 초기화한다", () => {
  const state = createEmptyStockBlogRetryV2State();
  state.attempts.reference_preflight = 1;
  state.completed.reference_preflight = true;
  state.attempts.content_generation = 1;
  state.completed.content_generation = true;
  state.attempts.draft_assembly = 1;

  const reopened = reopenStockBlogRetryV2ContentGeneration(state);
  assert.ok(reopened);
  assert.equal(reopened?.attempts.draft_assembly, 0);
  assert.equal(reopened?.completed.content_generation, false);
});

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
      reason: "NAVER_DRAFT_QUALITY_FAILED: adversarial-looking publish failure",
    }),
    false,
  );
  assert.equal(
    shouldClearRecoverablePipelineCircuitBreaker({
      active: true,
      status: "publishing_unknown",
      reason: "STOCK_REFERENCE_PREFLIGHT_BLOCKED: stale publishing must stay blocked",
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

test("07:30까지 사전검증을 반복한 오전 글은 생성 품질 오류도 자동 복구한다", () => {
  const allowed = evaluateStockBlogSchedulerRetry({
    exists: true,
    status: "failed",
    previousAttempt: 6,
    elapsedMs: 10 * 60 * 1000,
    autoPublish: true,
    autoPublishRetryLimit: 2,
    maxRetries: 5,
    retryDelayMinutes: 10,
    retryableGenerationFailure: true,
  });
  const blocked = evaluateStockBlogSchedulerRetry({
    exists: true,
    status: "failed",
    previousAttempt: 9,
    elapsedMs: 10 * 60 * 1000,
    autoPublish: true,
    autoPublishRetryLimit: 2,
    maxRetries: 5,
    retryDelayMinutes: 10,
    retryableGenerationFailure: true,
  });

  assert.deepEqual(allowed, { allowed: true, attempt: 7 });
  assert.equal(blocked.allowed, false);
});

test("사전검증 뒤 생성 품질을 코드로 수정하면 네 번째 수동 복구까지 허용한다", () => {
  const allowed = evaluateStockBlogSchedulerRetry({
    exists: true,
    status: "failed",
    previousAttempt: 15,
    elapsedMs: 60 * 60 * 1000,
    autoPublish: true,
    autoPublishRetryLimit: 2,
    maxRetries: 12,
    retryDelayMinutes: 10,
    retryableGenerationFailure: true,
    manualRecovery: true,
  });
  const blocked = evaluateStockBlogSchedulerRetry({
    exists: true,
    status: "failed",
    previousAttempt: 16,
    elapsedMs: 60 * 60 * 1000,
    autoPublish: true,
    autoPublishRetryLimit: 2,
    maxRetries: 12,
    retryDelayMinutes: 10,
    retryableGenerationFailure: true,
    manualRecovery: true,
  });

  assert.deepEqual(allowed, { allowed: true, attempt: 16 });
  assert.equal(blocked.allowed, false);
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

test("중단된 running 실행은 15분 뒤 같은 시도로 복구한다", () => {
  const waiting = evaluateStockBlogSchedulerRetry({
    exists: true,
    status: "running",
    previousAttempt: 2,
    elapsedMs: 10 * 60 * 1000,
    autoPublish: true,
    autoPublishRetryLimit: 2,
    maxRetries: 3,
    retryDelayMinutes: 10,
  });
  const recovered = evaluateStockBlogSchedulerRetry({
    exists: true,
    status: "running",
    previousAttempt: 2,
    elapsedMs: 15 * 60 * 1000,
    autoPublish: true,
    autoPublishRetryLimit: 2,
    maxRetries: 3,
    retryDelayMinutes: 10,
  });

  assert.equal(waiting.allowed, false);
  assert.deepEqual(recovered, { allowed: true, attempt: 2 });
});

test("시장자료는 세 번만 다시 받고 마감 시각이 되면 대체 글로 진행한다", () => {
  const waiting = evaluateStockBlogPhaseBudget({
    previousReason: "STOCK_REFERENCE_PREFLIGHT_BLOCKED: needs_data · S&P 500",
    referenceAttempt: 3,
    generationAttempt: 0,
    referenceMaxAttempts: 3,
    generationMaxAttempts: 2,
    dataFallbackCutoffReached: false,
  });
  const fallbackDue = evaluateStockBlogPhaseBudget({
    previousReason: "STOCK_REFERENCE_PREFLIGHT_BLOCKED: needs_data · S&P 500",
    referenceAttempt: 3,
    generationAttempt: 0,
    referenceMaxAttempts: 3,
    generationMaxAttempts: 2,
    dataFallbackCutoffReached: true,
  });

  assert.equal(waiting.allowed, false);
  assert.match(waiting.reason ?? "", /재조회 3회/);
  assert.deepEqual(fallbackDue, { allowed: true });
});

test("글 품질수정은 자동 두 번으로 제한하고 인증된 수동 복구는 허용한다", () => {
  const automatic = evaluateStockBlogPhaseBudget({
    previousReason: "STOCK_CONTENT_QUALITY_FAILED: QA 92",
    referenceAttempt: 3,
    generationAttempt: 2,
    referenceMaxAttempts: 3,
    generationMaxAttempts: 2,
    dataFallbackCutoffReached: true,
  });
  const manual = evaluateStockBlogPhaseBudget({
    previousReason: "STOCK_CONTENT_QUALITY_FAILED: QA 92",
    referenceAttempt: 3,
    generationAttempt: 2,
    referenceMaxAttempts: 3,
    generationMaxAttempts: 2,
    dataFallbackCutoffReached: true,
    manualRecovery: true,
  });

  assert.equal(automatic.allowed, false);
  assert.deepEqual(manual, { allowed: true });
});
