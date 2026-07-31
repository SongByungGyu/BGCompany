const SAFE_PRE_PUBLISH_RETRY_STATUSES = new Set([
  "failed",
  "readability_failed",
  "image_upload_failed",
  "draft_save_failed",
]);

export type NaverDraftSafeRetryDecision = {
  allowed: boolean;
  nextRetryCount: number;
  reason?: string;
};

export function getNaverDraftSafeRetryLimit(value?: string) {
  const parsed = Number.parseInt(value ?? "2", 10);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(parsed, 5)) : 2;
}

export function evaluateNaverDraftSafeRetry(input: {
  status: string;
  allowPublish: boolean;
  publishAttemptCount: number;
  retryCount: number;
  retryLimit: number;
}): NaverDraftSafeRetryDecision {
  if (!input.allowPublish) {
    return { allowed: false, nextRetryCount: input.retryCount, reason: "자동 발행 작업이 아닙니다." };
  }
  if (!SAFE_PRE_PUBLISH_RETRY_STATUSES.has(input.status)) {
    return { allowed: false, nextRetryCount: input.retryCount, reason: "안전 재시도 대상 상태가 아닙니다." };
  }
  if (input.publishAttemptCount > 0) {
    return { allowed: false, nextRetryCount: input.retryCount, reason: "발행 시도 이후에는 중복 게시 방지를 위해 자동 재시도하지 않습니다." };
  }
  if (input.retryCount >= input.retryLimit) {
    return { allowed: false, nextRetryCount: input.retryCount, reason: `안전 재시도 한도 ${input.retryLimit}회에 도달했습니다.` };
  }
  return { allowed: true, nextRetryCount: input.retryCount + 1 };
}
