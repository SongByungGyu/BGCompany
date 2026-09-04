export type StockBlogSchedulerRetryDecision = {
  allowed: boolean;
  attempt: number;
  reason?: string;
};

export type StockBlogSchedulerRetryPolicyInput = {
  exists: boolean;
  status: string;
  previousAttempt: number;
  elapsedMs: number;
  autoPublish: boolean;
  autoPublishRetryLimit: number;
  maxRetries: number;
  retryDelayMinutes: number;
  referencePreflightFailure?: boolean;
  retryableGenerationFailure?: boolean;
  manualRecovery?: boolean;
};

export type StockBlogRecoveryDateDecision = {
  allowed: boolean;
  reason?: string;
};

export type StockBlogPhaseBudgetDecision = {
  allowed: boolean;
  reason?: string;
};

export function resolveStockBlogRecoveryPublishTime(input: {
  standardPublishTime: string;
  manualRecovery: boolean;
  marketDate: string;
  currentMarketDate: string;
  currentTime: string;
  originalPublishAtMs: number;
  nowMs: number;
  lateTtlMinutes: number;
}) {
  const expired = input.nowMs > input.originalPublishAtMs + (input.lateTtlMinutes * 60_000);
  return input.manualRecovery && input.marketDate === input.currentMarketDate && expired
    ? input.currentTime
    : input.standardPublishTime;
}

export type StockBlogRetryPhase = "reference_preflight" | "content_generation" | "draft_assembly";

export type StockBlogRetryV2Lease = {
  phase: StockBlogRetryPhase;
  attempt: number;
  token: string;
  claimedAt: string;
  expiresAt: string;
};

export type StockBlogRetryV2State = {
  version: 2;
  attempts: Record<StockBlogRetryPhase, number>;
  completed: Record<StockBlogRetryPhase, boolean>;
  referenceRefreshRequired: boolean;
  lease: StockBlogRetryV2Lease | null;
};

export type StockBlogRetryV2ParseResult =
  | { ok: true; state: StockBlogRetryV2State; migratedFromLegacy: boolean }
  | { ok: false; reason: string };

export type StockBlogRetryV2ClaimDecision =
  | { action: "completed"; state: StockBlogRetryV2State }
  | { action: "blocked"; state: StockBlogRetryV2State; reason: string }
  | { action: "claim"; state: StockBlogRetryV2State; lease: StockBlogRetryV2Lease };

const STOCK_REFERENCE_PREFLIGHT_PREFIX = "STOCK_REFERENCE_PREFLIGHT_BLOCKED:";
const STOCK_CONTENT_QUALITY_PREFIX = "STOCK_CONTENT_QUALITY_FAILED:";
const NAVER_DRAFT_QUALITY_PREFIX = "NAVER_DRAFT_QUALITY_FAILED:";

export const STOCK_BLOG_RETRY_PHASE_LIMITS = { reference_preflight: 4, content_generation: 2, draft_assembly: 2 } as const;
export const STOCK_BLOG_MANUAL_RECOVERY_GENERATION_LIMIT = STOCK_BLOG_RETRY_PHASE_LIMITS.content_generation + 2;
// Content generation can use multiple serial Hermes calls plus image generation,
// while reference collection and draft assembly should recover inside the same
// publication window after a crashed worker.
export const STOCK_BLOG_RETRY_PHASE_LEASE_MS: Record<StockBlogRetryPhase, number> = {
  reference_preflight: 20 * 60 * 1000,
  content_generation: 90 * 60 * 1000,
  draft_assembly: 10 * 60 * 1000,
};
const STOCK_BLOG_LEGACY_RUNNING_LEASE_MS = 15 * 60 * 1000;

const STOCK_BLOG_RETRY_PHASES = ["reference_preflight", "content_generation", "draft_assembly"] as const;

export function createEmptyStockBlogRetryV2State(): StockBlogRetryV2State {
  return {
    version: 2,
    attempts: { reference_preflight: 0, content_generation: 0, draft_assembly: 0 },
    completed: { reference_preflight: false, content_generation: false, draft_assembly: false },
    referenceRefreshRequired: false,
    lease: null,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isPhase(value: unknown): value is StockBlogRetryPhase {
  return typeof value === "string" && STOCK_BLOG_RETRY_PHASES.includes(value as StockBlogRetryPhase);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function parseRetryV2State(value: unknown): StockBlogRetryV2State | null {
  if (!isRecord(value) || value.version !== 2 || !isRecord(value.attempts) || !isRecord(value.completed)) return null;
  const attempts = value.attempts;
  const completed = value.completed;
  const referenceRefreshRequired = value.referenceRefreshRequired === undefined
    ? false
    : value.referenceRefreshRequired;
  if (typeof referenceRefreshRequired !== "boolean") return null;
  if (!STOCK_BLOG_RETRY_PHASES.every((phase) => isNonNegativeInteger(attempts[phase]) && typeof completed[phase] === "boolean")) return null;
  if ((completed.content_generation && !completed.reference_preflight)
    || (completed.draft_assembly && !completed.content_generation)) return null;
  if (STOCK_BLOG_RETRY_PHASES.some((phase) => completed[phase] === true && attempts[phase] === 0)) return null;
  if ((attempts.content_generation as number) > 0 && completed.reference_preflight !== true) return null;
  if ((attempts.draft_assembly as number) > 0 && completed.content_generation !== true) return null;
  if (referenceRefreshRequired && (
    completed.reference_preflight !== true
    || completed.content_generation === true
    || completed.draft_assembly === true
    || attempts.draft_assembly !== 0
  )) return null;
  let lease: StockBlogRetryV2Lease | null = null;
  if (value.lease !== null) {
    if (!isRecord(value.lease)
      || !isPhase(value.lease.phase)
      || !isNonNegativeInteger(value.lease.attempt)
      || value.lease.attempt < 1
      || typeof value.lease.token !== "string"
      || value.lease.token.length < 8
      || typeof value.lease.claimedAt !== "string"
      || typeof value.lease.expiresAt !== "string"
      || !Number.isFinite(Date.parse(value.lease.claimedAt))
      || !Number.isFinite(Date.parse(value.lease.expiresAt))
      || Date.parse(value.lease.expiresAt) <= Date.parse(value.lease.claimedAt)
      || value.lease.attempt !== attempts[value.lease.phase]) return null;
    const referenceRefreshLease = referenceRefreshRequired && value.lease.phase === "reference_preflight";
    if ((completed[value.lease.phase] === true && !referenceRefreshLease)
      || (referenceRefreshRequired && value.lease.phase !== "reference_preflight")
      || (value.lease.phase === "content_generation" && (completed.reference_preflight !== true || referenceRefreshRequired))
      || (value.lease.phase === "draft_assembly" && completed.content_generation !== true)) return null;
    lease = {
      phase: value.lease.phase,
      attempt: value.lease.attempt,
      token: value.lease.token,
      claimedAt: value.lease.claimedAt,
      expiresAt: value.lease.expiresAt,
    };
  }
  return {
    version: 2,
    attempts: {
      reference_preflight: attempts.reference_preflight as number,
      content_generation: attempts.content_generation as number,
      draft_assembly: attempts.draft_assembly as number,
    },
    completed: {
      reference_preflight: completed.reference_preflight as boolean,
      content_generation: completed.content_generation as boolean,
      draft_assembly: completed.draft_assembly as boolean,
    },
    referenceRefreshRequired,
    lease,
  };
}

function legacyCount(value: unknown) {
  return isNonNegativeInteger(value) ? value : null;
}

export function parseStockBlogRetryV2(input: {
  payload: unknown;
  eventTimestamp?: Date;
  leaseMs?: number;
}): StockBlogRetryV2ParseResult {
  const payload = isRecord(input.payload) ? input.payload : {};
  if (Object.prototype.hasOwnProperty.call(payload, "retryV2")) {
    const parsed = parseRetryV2State(payload.retryV2);
    return parsed
      ? { ok: true, state: parsed, migratedFromLegacy: false }
      : { ok: false, reason: "retryV2 상태가 손상되어 자동 재시도를 안전하게 중단했습니다." };
  }

  const state = createEmptyStockBlogRetryV2State();
  const reason = typeof payload.reason === "string" ? payload.reason : "";
  const status = typeof payload.status === "string" ? payload.status : "";
  const legacyAttempt = legacyCount(payload.attempt) ?? 0;
  const draftAssemblyFailure = isNaverDraftAssemblyQualityFailure(reason);
  state.attempts.reference_preflight = legacyCount(payload.referenceAttempt)
    ?? (isStockReferencePreflightFailure(reason) ? Math.max(1, legacyAttempt) : 0);
  state.attempts.content_generation = legacyCount(payload.generationAttempt)
    ?? (draftAssemblyFailure
      ? 1
      : isStockContentQualityFailure(reason)
        ? Math.max(1, legacyAttempt)
        : 0);
  state.attempts.draft_assembly = legacyCount(payload.draftAssemblyAttempt)
    ?? (draftAssemblyFailure ? 1 : 0);

  const pipelineId = typeof payload.pipelineId === "string" && payload.pipelineId.trim();
  const draftJobId = typeof payload.naverDraftJobId === "string" && payload.naverDraftJobId.trim();
  state.completed.reference_preflight = Boolean(pipelineId || draftJobId)
    || state.attempts.content_generation > 0
    || state.attempts.draft_assembly > 0
    || status === "succeeded";
  state.completed.content_generation = Boolean(draftJobId)
    || status === "succeeded"
    || (Boolean(pipelineId) && (!isStockContentQualityFailure(reason) || draftAssemblyFailure));
  state.completed.draft_assembly = Boolean(draftJobId) || status === "succeeded";
  if (state.completed.reference_preflight) state.attempts.reference_preflight = Math.max(1, state.attempts.reference_preflight);
  if (state.completed.content_generation) state.attempts.content_generation = Math.max(1, state.attempts.content_generation);
  if (state.completed.draft_assembly) state.attempts.draft_assembly = Math.max(1, state.attempts.draft_assembly);

  if (status === "running" && input.eventTimestamp) {
    const phase: StockBlogRetryPhase = state.completed.content_generation
      ? "draft_assembly"
      : state.completed.reference_preflight
        ? "content_generation"
        : "reference_preflight";
    state.attempts[phase] = Math.max(1, state.attempts[phase]);
    const claimedAt = input.eventTimestamp.toISOString();
    state.lease = {
      phase,
      attempt: state.attempts[phase],
      token: `legacy-${input.eventTimestamp.getTime()}`,
      claimedAt,
      expiresAt: new Date(input.eventTimestamp.getTime() + (input.leaseMs ?? STOCK_BLOG_LEGACY_RUNNING_LEASE_MS)).toISOString(),
    };
  }
  return { ok: true, state, migratedFromLegacy: true };
}

export function evaluateStockBlogRetryV2Claim(input: {
  state: StockBlogRetryV2State;
  phase: StockBlogRetryPhase;
  now: Date;
  token: string;
  leaseMs?: number;
  maxAttempts?: number;
}): StockBlogRetryV2ClaimDecision {
  const state: StockBlogRetryV2State = {
    ...input.state,
    attempts: { ...input.state.attempts },
    completed: { ...input.state.completed },
    lease: input.state.lease ? { ...input.state.lease } : null,
  };
  if (state.lease && Date.parse(state.lease.expiresAt) > input.now.getTime()) {
    return { action: "blocked", state, reason: `${state.lease.phase} 단계가 다른 실행에서 처리 중입니다.` };
  }
  state.lease = null;
  if (state.referenceRefreshRequired && input.phase !== "reference_preflight") {
    return { action: "blocked", state, reason: "참고자료 갱신이 완료되기 전에는 후행 단계를 실행할 수 없습니다." };
  }
  const refreshingReference = state.referenceRefreshRequired && input.phase === "reference_preflight";
  if (state.completed[input.phase] && !refreshingReference) return { action: "completed", state };
  if ((input.phase === "content_generation" && !state.completed.reference_preflight)
    || (input.phase === "draft_assembly" && !state.completed.content_generation)) {
    return { action: "blocked", state, reason: `${input.phase} 단계의 선행 단계가 완료되지 않았습니다.` };
  }
  const defaultLimit = STOCK_BLOG_RETRY_PHASE_LIMITS[input.phase];
  const limit = isNonNegativeInteger(input.maxAttempts)
    ? Math.max(defaultLimit, input.maxAttempts)
    : defaultLimit;
  if (state.attempts[input.phase] >= limit) {
    return { action: "blocked", state, reason: `${input.phase} 단계 시도 한도 ${limit}회에 도달했습니다.` };
  }
  const attempt = state.attempts[input.phase] + 1;
  const claimedAt = input.now.toISOString();
  const lease: StockBlogRetryV2Lease = {
    phase: input.phase,
    attempt,
    token: input.token,
    claimedAt,
    expiresAt: new Date(input.now.getTime() + (input.leaseMs ?? STOCK_BLOG_RETRY_PHASE_LEASE_MS[input.phase])).toISOString(),
  };
  state.attempts[input.phase] = attempt;
  state.lease = lease;
  return { action: "claim", state, lease };
}

export function settleStockBlogRetryV2Claim(input: {
  state: StockBlogRetryV2State;
  token: string;
  succeeded: boolean;
  consumeAttempt?: boolean;
}): StockBlogRetryV2State | null {
  const lease = input.state.lease;
  if (!lease || lease.token !== input.token) return null;
  const state: StockBlogRetryV2State = {
    ...input.state,
    attempts: { ...input.state.attempts },
    completed: { ...input.state.completed },
    lease: null,
  };
  if (input.consumeAttempt === false) {
    state.attempts[lease.phase] = Math.max(0, state.attempts[lease.phase] - 1);
    return state;
  }
  if (input.succeeded) {
    state.completed[lease.phase] = true;
    if (lease.phase === "reference_preflight") state.referenceRefreshRequired = false;
  }
  return state;
}

export function requestStockBlogRetryV2ReferenceRefresh(state: StockBlogRetryV2State): StockBlogRetryV2State | null {
  if (state.referenceRefreshRequired) return {
    ...state,
    attempts: { ...state.attempts },
    completed: { ...state.completed },
    lease: state.lease ? { ...state.lease } : null,
  };
  if (state.lease
    || !state.completed.reference_preflight
    || state.completed.draft_assembly) return null;
  return {
    ...state,
    attempts: { ...state.attempts, draft_assembly: 0 },
    completed: {
      ...state.completed,
      reference_preflight: true,
      content_generation: false,
      draft_assembly: false,
    },
    referenceRefreshRequired: true,
    lease: null,
  };
}

export function reopenStockBlogRetryV2ContentGeneration(state: StockBlogRetryV2State): StockBlogRetryV2State | null {
  if (state.lease
    || !state.completed.reference_preflight
    || !state.completed.content_generation
    || state.completed.draft_assembly) return null;
  return {
    ...state,
    attempts: { ...state.attempts, draft_assembly: 0 },
    completed: {
      ...state.completed,
      content_generation: false,
      draft_assembly: false,
    },
    lease: null,
  };
}

export function buildStockBlogLogicalScheduleKey(scheduleId: string, marketDate: string) {
  return `${scheduleId}-${marketDate.replace(/-/g, "")}`;
}

export function buildStockBlogLogicalPublishKey(scheduleId: string, marketDate: string) {
  return `stock-blog:${scheduleId}:${marketDate}`;
}

export function buildStockBlogLegacyPublishKeyAliases(input: { contentType: string; marketDate: string; publishTime: string; legacyTimes?: string[] }) {
  return Array.from(new Set([input.publishTime, ...(input.legacyTimes ?? [])]))
    .map((time) => `${input.contentType}:${input.marketDate}:${time}`);
}

export function isStockReferencePreflightFailure(reason: string) {
  return reason.trimStart().startsWith(STOCK_REFERENCE_PREFLIGHT_PREFIX);
}

export function isStockContentQualityFailure(reason: string) {
  const normalized = reason.trimStart();
  return normalized.startsWith(STOCK_CONTENT_QUALITY_PREFIX)
    || normalized.startsWith(NAVER_DRAFT_QUALITY_PREFIX);
}

export function isNaverDraftAssemblyQualityFailure(reason: string) {
  return reason.includes(NAVER_DRAFT_QUALITY_PREFIX);
}

export function evaluateStockBlogPhaseBudget(input: {
  previousReason: string;
  referenceAttempt: number;
  generationAttempt: number;
  referenceMaxAttempts?: number;
  generationMaxAttempts?: number;
  dataFallbackCutoffReached: boolean;
  manualRecovery?: boolean;
}): StockBlogPhaseBudgetDecision {
  if (
    isStockReferencePreflightFailure(input.previousReason)
    && input.referenceMaxAttempts
    && input.referenceAttempt >= input.referenceMaxAttempts
    && !input.dataFallbackCutoffReached
  ) {
    return {
      allowed: false,
      reason: `시장자료 재조회 ${input.referenceMaxAttempts}회를 마쳐 마감 대체 시각까지 대기합니다.`,
    };
  }
  if (
    isStockContentQualityFailure(input.previousReason)
    && input.generationMaxAttempts
    && input.generationAttempt >= input.generationMaxAttempts
    && !input.manualRecovery
  ) {
    return {
      allowed: false,
      reason: `글 생성·품질수정 ${input.generationMaxAttempts}회를 마쳐 자동 재생성을 중단했습니다.`,
    };
  }
  return { allowed: true };
}

export function shouldClearReferencePreflightCircuitBreaker(input: {
  active: boolean;
  reason: string;
}) {
  return input.active && isStockReferencePreflightFailure(input.reason);
}

export function shouldClearRecoverablePipelineCircuitBreaker(input: {
  active: boolean;
  status: string;
  reason: string;
}) {
  if (input.status === "publish_failed" || input.status === "publishing_unknown") return false;
  return input.active && (
    input.status === "quality_failed"
    || isStockReferencePreflightFailure(input.reason)
    || isStockContentQualityFailure(input.reason)
  );
}

export function evaluateStockBlogRecoveryDate(input: {
  scheduledDate: string;
  todayDate: string;
  weekdays: number[];
  maxAgeDays?: number;
}): StockBlogRecoveryDateDecision {
  const parseDate = (value: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const date = new Date(`${value}T00:00:00Z`);
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) return null;
    return date;
  };
  const scheduled = parseDate(input.scheduledDate);
  const today = parseDate(input.todayDate);
  if (!scheduled || !today) {
    return { allowed: false, reason: "scheduledDate는 YYYY-MM-DD 형식의 유효한 날짜여야 합니다." };
  }
  if (!input.weekdays.includes(scheduled.getUTCDay())) {
    return { allowed: false, reason: "해당 날짜는 이 스케줄의 실행 요일이 아닙니다." };
  }
  const ageDays = Math.floor((today.getTime() - scheduled.getTime()) / 86_400_000);
  if (ageDays < 0) return { allowed: false, reason: "미래 일정은 복구 실행할 수 없습니다." };
  if (ageDays > (input.maxAgeDays ?? 7)) {
    return { allowed: false, reason: `최근 ${input.maxAgeDays ?? 7}일 이내 일정만 복구할 수 있습니다.` };
  }
  return { allowed: true };
}

export function evaluateStockBlogSchedulerRetry(
  input: StockBlogSchedulerRetryPolicyInput,
): StockBlogSchedulerRetryDecision {
  if (!input.exists) return { allowed: true, attempt: 1 };
  const preserveAttempt = input.status === "deferred" || input.status === "running";
  const retryableStatus = input.status === "failed"
    || (input.status === "partial_failed" && input.retryableGenerationFailure)
    || preserveAttempt;
  if (!retryableStatus) {
    return {
      allowed: false,
      attempt: input.previousAttempt,
      reason: "이미 처리된 스케줄입니다.",
    };
  }

  const maxAttempts = input.autoPublish
    ? input.referencePreflightFailure
      ? Math.max(2, input.maxRetries)
      : 1 + Math.max(
        input.autoPublishRetryLimit,
        input.retryableGenerationFailure ? 1 : 0,
      )
    : input.maxRetries;
  const carriedReferencePreflightAttempts = Boolean(
    input.retryableGenerationFailure
      && input.previousAttempt > maxAttempts + 1,
  );
  const manualRecoveryLimit = carriedReferencePreflightAttempts
    ? input.maxRetries + maxAttempts + 1
    : Math.max(maxAttempts + 1, input.maxRetries);
  const effectiveMaxAttempts = input.autoPublish && carriedReferencePreflightAttempts
    ? manualRecoveryLimit
    : maxAttempts;
  const manualRecoveryAllowed = input.manualRecovery
    && input.status !== "running"
    && input.status !== "deferred"
    && (input.referencePreflightFailure || input.retryableGenerationFailure)
    && input.previousAttempt < manualRecoveryLimit;
  if (manualRecoveryAllowed) {
    return { allowed: true, attempt: input.previousAttempt + 1 };
  }

  if (!preserveAttempt && input.previousAttempt >= effectiveMaxAttempts) {
    return {
      allowed: false,
      attempt: input.previousAttempt,
      reason: `실패 재시도 한도 ${Math.max(0, effectiveMaxAttempts - 1)}회에 도달했습니다.`,
    };
  }

  const delayMs = input.status === "running"
    ? Math.max(input.retryDelayMinutes, 15) * 60 * 1000
    : input.retryDelayMinutes * 60 * 1000;
  // Scheduler ticks run on exact 10-minute boundaries, while the previous
  // attempt timestamp is written after collection finishes. Allow a small
  // alignment grace so a short failed collection does not postpone the next
  // retry by another full scheduler interval.
  const alignmentGraceMs = Math.min(60_000, Math.floor(delayMs * 0.1));
  const effectiveDelayMs = Math.max(0, delayMs - alignmentGraceMs);
  if (input.elapsedMs < effectiveDelayMs) {
    const waitMinutes = Math.max(
      1,
      Math.ceil((effectiveDelayMs - input.elapsedMs) / 60000),
    );
    return {
      allowed: false,
      attempt: input.previousAttempt,
      reason: `실패 재시도 대기 중 · 약 ${waitMinutes}분 후 가능`,
    };
  }

  return {
    allowed: true,
    attempt: preserveAttempt ? input.previousAttempt : input.previousAttempt + 1,
  };
}
