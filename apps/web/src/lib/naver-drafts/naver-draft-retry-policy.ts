const SAFE_PRE_PUBLISH_RETRY_STATUSES = new Set([
  "failed",
  "readability_failed",
  "image_upload_failed",
  "draft_save_failed",
]);

const GLOBAL_PUBLISH_BLOCKING_STATUSES = new Set([
  "publish_failed",
  "login_required",
  "captcha_required",
  "security_check_required",
]);

export type NaverDraftSafeRetryDecision = {
  allowed: boolean;
  nextRetryCount: number;
  reason?: string;
};

export function getNaverDraftSafeRetryLimit(value?: string) {
  const parsed = Number.parseInt(value ?? "8", 10);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(parsed, 12)) : 8;
}

export function shouldActivateNaverPublishCircuitBreaker(input: {
  status: string;
  allowPublish: boolean;
}) {
  return input.allowPublish && GLOBAL_PUBLISH_BLOCKING_STATUSES.has(input.status);
}

export function evaluateNaverDraftSafeRetry(input: {
  status: string;
  allowPublish: boolean;
  publishAttemptCount: number;
  retryCount: number;
  retryLimit: number;
  errorCode?: string | null;
  errorMessage?: string | null;
}): NaverDraftSafeRetryDecision {
  if (!input.allowPublish) {
    return { allowed: false, nextRetryCount: input.retryCount, reason: "자동 발행 작업이 아닙니다." };
  }
  const recoverableEditorImageFailure = input.status === "image_quality_failed"
    && input.errorCode === "NAVER_IMAGE_QUALITY_FAILED"
    && /^NAVER_(?:(?:IMAGE|THUMBNAIL)_CAPTION_INSERT_FAILED(?:_|$)|IMAGE_CAPTION_LAYOUT_FAILED_|IMAGE_PLACEMENT_VERIFY_FAILED_)/.test(input.errorMessage ?? "");
  if (!SAFE_PRE_PUBLISH_RETRY_STATUSES.has(input.status) && !recoverableEditorImageFailure) {
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
