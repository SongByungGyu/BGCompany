export const NAVER_AUTH_HOLD_EVENT_ID = "event-naver-publisher-auth-hold";
export const NAVER_SESSION_READY_CODE = "NAVER_SESSION_READY";

const AUTH_HOLD_STATUSES = new Set([
  "login_required",
  "captcha_required",
  "security_check_required",
]);

const SAFE_TERMINAL_STATUSES = new Set([
  "cancelled",
  "completed",
  "draft_saved",
  "failed",
  "readability_failed",
  "image_upload_failed",
  "image_quality_failed",
  "draft_save_failed",
  "published",
  "user_publish_required",
  "publish_blocked",
  "publish_failed",
  "duplicate_blocked",
  "quality_failed",
  "reference_failed",
  "market_data_failed",
]);

export type NaverAuthHoldSnapshot = {
  active: boolean;
  jobId: string | null;
  status: string | null;
  heldAt: string | null;
  retryAfter: string | null;
  probeCount: number;
};

export type NaverAuthHoldDecision =
  | { action: "normal" }
  | { action: "clear"; reason: string }
  | { action: "wait"; reason: string }
  | { action: "probe"; jobId: string };

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function isNaverAuthHoldStatus(status: string) {
  return AUTH_HOLD_STATUSES.has(status);
}

export function getNaverAuthHoldCooldownMs(value?: string) {
  const seconds = Number.parseInt(value ?? "300", 10);
  const boundedSeconds = Number.isFinite(seconds)
    ? Math.max(30, Math.min(seconds, 3600))
    : 300;
  return boundedSeconds * 1000;
}

export function parseNaverAuthHoldSnapshot(value: unknown): NaverAuthHoldSnapshot {
  const payload = record(value);
  return {
    active: payload.active === true,
    jobId: text(payload.jobId),
    status: text(payload.status),
    heldAt: text(payload.heldAt),
    retryAfter: text(payload.retryAfter),
    probeCount: typeof payload.probeCount === "number" && Number.isFinite(payload.probeCount)
      ? Math.max(0, Math.floor(payload.probeCount))
      : 0,
  };
}

export function canRequeueNaverAuthHoldJob(publishAttemptCount: number) {
  return Number.isFinite(publishAttemptCount) && publishAttemptCount === 0;
}

export function evaluateNaverAuthHold(input: {
  snapshot: NaverAuthHoldSnapshot;
  nowMs: number;
  heldJob: {
    id: string;
    status: string;
    publishAttemptCount: number;
    claimable: boolean;
  } | null;
}): NaverAuthHoldDecision {
  if (!input.snapshot.active) return { action: "normal" };
  if (!input.snapshot.jobId) return { action: "clear", reason: "AUTH_HOLD_JOB_ID_MISSING" };
  if (!input.heldJob || input.heldJob.id !== input.snapshot.jobId) {
    return { action: "clear", reason: "AUTH_HOLD_JOB_MISSING" };
  }
  if (SAFE_TERMINAL_STATUSES.has(input.heldJob.status)) {
    return { action: "clear", reason: `AUTH_HOLD_JOB_TERMINAL:${input.heldJob.status}` };
  }
  if (!canRequeueNaverAuthHoldJob(input.heldJob.publishAttemptCount)) {
    return { action: "wait", reason: "AUTH_HOLD_AFTER_PUBLISH_ATTEMPT_REQUIRES_REVIEW" };
  }
  const retryAfterMs = Date.parse(input.snapshot.retryAfter ?? "");
  if (Number.isFinite(retryAfterMs) && input.nowMs < retryAfterMs) {
    return { action: "wait", reason: "AUTH_HOLD_COOLDOWN" };
  }
  if (!input.heldJob.claimable) {
    return { action: "wait", reason: "AUTH_HOLD_JOB_ALREADY_CLAIMED" };
  }
  return { action: "probe", jobId: input.heldJob.id };
}

export function isNaverSessionReadyProgress(input: { status: string; errorCode?: string | null }) {
  return input.status === "in_progress" && input.errorCode === NAVER_SESSION_READY_CODE;
}

