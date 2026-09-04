const TERMINAL_STATUSES = new Set([
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

const AUTH_HOLD_STATUSES = new Set([
  "login_required",
  "captcha_required",
  "security_check_required",
]);

const PRE_PUBLISH_FAILURES = new Set([
  "failed",
  "readability_failed",
  "image_upload_failed",
  "image_quality_failed",
  "draft_save_failed",
  ...AUTH_HOLD_STATUSES,
]);

const ALLOWED_AGENT_TRANSITIONS: Record<string, ReadonlySet<string>> = {
  claimed: new Set(["in_progress", "failed"]),
  in_progress: new Set([
    "in_progress",
    "image_uploading",
    "draft_saving",
    "draft_saved",
    "user_publish_required",
    ...PRE_PUBLISH_FAILURES,
  ]),
  image_uploading: new Set([
    "image_uploading",
    "in_progress",
    "draft_saving",
    "user_publish_required",
    ...PRE_PUBLISH_FAILURES,
  ]),
  draft_saving: new Set([
    "draft_saving",
    "publish_ready",
    "draft_saved",
    "user_publish_required",
    ...PRE_PUBLISH_FAILURES,
  ]),
  publish_ready: new Set([
    "publish_ready",
    ...PRE_PUBLISH_FAILURES,
  ]),
  publishing: new Set(["published", "publish_failed"]),
};

export function isNaverDraftTerminalStatus(status: string) {
  return TERMINAL_STATUSES.has(status);
}

export function isAllowedNaverAgentTransition(currentStatus: string, nextStatus: string) {
  return ALLOWED_AGENT_TRANSITIONS[currentStatus]?.has(nextStatus) === true;
}

export function getNaverPublishingStaleMs(value?: string) {
  const parsed = Number.parseInt(value ?? "300", 10);
  const boundedSeconds = Number.isFinite(parsed)
    ? Math.max(60, Math.min(parsed, 3600))
    : 300;
  return boundedSeconds * 1000;
}

export function isNaverPublishingStale(updatedAt: Date, now = new Date(), value?: string) {
  return now.getTime() - updatedAt.getTime() >= getNaverPublishingStaleMs(value);
}
