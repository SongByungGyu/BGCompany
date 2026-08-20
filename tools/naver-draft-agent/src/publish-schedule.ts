export const PUBLISH_HEARTBEAT_INTERVAL_MS = 30_000;

export function getScheduledPublishWaitMs(publishNotBefore?: string | null, nowMs = Date.now()) {
  if (!publishNotBefore) return 0;
  const scheduledMs = Date.parse(publishNotBefore);
  if (!Number.isFinite(scheduledMs)) return 0;
  return Math.max(0, scheduledMs - nowMs);
}

export function nextPublishHeartbeatDelay(waitMs: number) {
  return Math.min(Math.max(0, waitMs), PUBLISH_HEARTBEAT_INTERVAL_MS);
}
