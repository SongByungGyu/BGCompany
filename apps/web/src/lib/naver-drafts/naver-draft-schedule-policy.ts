const KST_OFFSET_MINUTES = 9 * 60;
const DEFAULT_CLAIM_LEAD_MINUTES = 15;
const DEFAULT_LATE_TTL_MINUTES = 120;

function parsePositiveInt(value: string | undefined, fallback: number) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function getNaverDraftLateTtlMinutes(value = process.env.NAVER_DRAFT_LATE_TTL_MINUTES) {
  return Math.max(15, Math.min(parsePositiveInt(value, DEFAULT_LATE_TTL_MINUTES), 24 * 60));
}

export function resolveNaverDraftSchedule(input: {
  marketDate?: string | null;
  scheduleSlot?: string | null;
  claimLeadMinutes?: number;
}) {
  const marketDate = input.marketDate?.trim() ?? "";
  const scheduleSlot = input.scheduleSlot?.trim() ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(marketDate) || !/^\d{2}:\d{2}$/.test(scheduleSlot)) return null;
  const [year, month, day] = marketDate.split("-").map(Number);
  const [hour, minute] = scheduleSlot.split(":").map(Number);
  if (hour > 23 || minute > 59) return null;
  const wallClock = new Date(Date.UTC(year, month - 1, day, hour, minute));
  if (
    wallClock.getUTCFullYear() !== year
    || wallClock.getUTCMonth() !== month - 1
    || wallClock.getUTCDate() !== day
    || wallClock.getUTCHours() !== hour
    || wallClock.getUTCMinutes() !== minute
  ) return null;
  const publishAt = new Date(wallClock.getTime() - KST_OFFSET_MINUTES * 60_000);
  const configuredLead = parsePositiveInt(process.env.NAVER_DRAFT_CLAIM_LEAD_MINUTES, DEFAULT_CLAIM_LEAD_MINUTES);
  const claimLeadMinutes = input.claimLeadMinutes ?? configuredLead;
  const claimAt = new Date(publishAt.getTime() - Math.max(1, claimLeadMinutes) * 60_000);
  const publishNotAfter = new Date(publishAt.getTime() + getNaverDraftLateTtlMinutes() * 60_000);
  return {
    publishNotBefore: publishAt,
    publishNotAfter,
    claimAvailableAt: claimAt,
  };
}

export function isNaverDraftScheduleExpired(input: {
  marketDate?: string | null;
  scheduleSlot?: string | null;
}, now = new Date()) {
  const schedule = resolveNaverDraftSchedule(input);
  return Boolean(schedule && now.getTime() > schedule.publishNotAfter.getTime());
}

export function isNaverDraftClaimDue(input: {
  marketDate?: string | null;
  scheduleSlot?: string | null;
}, now = new Date()) {
  const schedule = resolveNaverDraftSchedule(input);
  return !schedule || now.getTime() >= schedule.claimAvailableAt.getTime();
}

export function isNaverDraftPublishDue(input: {
  marketDate?: string | null;
  scheduleSlot?: string | null;
}, now = new Date()) {
  const schedule = resolveNaverDraftSchedule(input);
  return !schedule || now.getTime() >= schedule.publishNotBefore.getTime();
}
