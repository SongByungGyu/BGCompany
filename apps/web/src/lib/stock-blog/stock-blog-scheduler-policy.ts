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
};

const STOCK_REFERENCE_PREFLIGHT_PREFIX = "STOCK_REFERENCE_PREFLIGHT_BLOCKED:";
const STOCK_CONTENT_QUALITY_PREFIX = "STOCK_CONTENT_QUALITY_FAILED:";

export function isStockReferencePreflightFailure(reason: string) {
  return reason.trimStart().startsWith(STOCK_REFERENCE_PREFLIGHT_PREFIX);
}

export function isStockContentQualityFailure(reason: string) {
  return reason.trimStart().startsWith(STOCK_CONTENT_QUALITY_PREFIX);
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

export function evaluateStockBlogSchedulerRetry(
  input: StockBlogSchedulerRetryPolicyInput,
): StockBlogSchedulerRetryDecision {
  if (!input.exists) return { allowed: true, attempt: 1 };
  const retryableStatus = input.status === "failed"
    || (input.status === "partial_failed" && input.retryableGenerationFailure);
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
  if (input.previousAttempt >= maxAttempts) {
    return {
      allowed: false,
      attempt: input.previousAttempt,
      reason: `실패 재시도 한도 ${Math.max(0, maxAttempts - 1)}회에 도달했습니다.`,
    };
  }

  const delayMs = input.retryDelayMinutes * 60 * 1000;
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

  return { allowed: true, attempt: input.previousAttempt + 1 };
}
