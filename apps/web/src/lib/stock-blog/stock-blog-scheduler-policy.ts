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

const STOCK_REFERENCE_PREFLIGHT_PREFIX = "STOCK_REFERENCE_PREFLIGHT_BLOCKED:";
const STOCK_CONTENT_QUALITY_PREFIX = "STOCK_CONTENT_QUALITY_FAILED:";
const NAVER_DRAFT_QUALITY_PREFIX = "NAVER_DRAFT_QUALITY_FAILED:";

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
  const manualRecoveryAllowed = input.manualRecovery
    && input.status !== "running"
    && input.status !== "deferred"
    && (input.referencePreflightFailure || input.retryableGenerationFailure)
    && input.previousAttempt < Math.max(maxAttempts + 1, input.maxRetries);
  if (manualRecoveryAllowed) {
    return { allowed: true, attempt: input.previousAttempt + 1 };
  }

  if (!preserveAttempt && input.previousAttempt >= maxAttempts) {
    return {
      allowed: false,
      attempt: input.previousAttempt,
      reason: `실패 재시도 한도 ${Math.max(0, maxAttempts - 1)}회에 도달했습니다.`,
    };
  }

  const delayMs = input.status === "running"
    ? Math.max(input.retryDelayMinutes, 30) * 60 * 1000
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
