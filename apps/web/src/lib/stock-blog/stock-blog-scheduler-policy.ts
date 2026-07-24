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
};

const STOCK_REFERENCE_PREFLIGHT_PREFIX = "STOCK_REFERENCE_PREFLIGHT_BLOCKED:";

export function isStockReferencePreflightFailure(reason: string) {
  return reason.trimStart().startsWith(STOCK_REFERENCE_PREFLIGHT_PREFIX);
}

export function evaluateStockBlogSchedulerRetry(
  input: StockBlogSchedulerRetryPolicyInput,
): StockBlogSchedulerRetryDecision {
  if (!input.exists) return { allowed: true, attempt: 1 };
  if (input.status !== "failed") {
    return {
      allowed: false,
      attempt: input.previousAttempt,
      reason: "이미 처리된 스케줄입니다.",
    };
  }

  const maxAttempts = input.autoPublish
    ? 1 + input.autoPublishRetryLimit
    : input.maxRetries;
  if (input.previousAttempt >= maxAttempts) {
    return {
      allowed: false,
      attempt: input.previousAttempt,
      reason: `실패 재시도 한도 ${Math.max(0, maxAttempts - 1)}회에 도달했습니다.`,
    };
  }

  const delayMs = input.retryDelayMinutes * 60 * 1000;
  if (input.elapsedMs < delayMs) {
    const waitMinutes = Math.max(
      1,
      Math.ceil((delayMs - input.elapsedMs) / 60000),
    );
    return {
      allowed: false,
      attempt: input.previousAttempt,
      reason: `실패 재시도 대기 중 · 약 ${waitMinutes}분 후 가능`,
    };
  }

  return { allowed: true, attempt: input.previousAttempt + 1 };
}
