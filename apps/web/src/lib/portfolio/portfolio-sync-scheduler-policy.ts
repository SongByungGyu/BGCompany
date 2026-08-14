export type PortfolioAutoSyncConfig = {
  enabled: boolean;
  cron: string;
  timezone: string;
  retryLimit: number;
};

export type PortfolioAutoSyncRunState = {
  status: string;
  attempt: number;
};

const DEFAULT_CRON = "30 8 * * *";
const DEFAULT_TIMEZONE = "Asia/Seoul";

function parseBoolean(value: string | undefined) {
  return value?.trim().toLowerCase() === "true";
}

function validTimezone(value: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

export function parseDailyCron(value: string | undefined) {
  const cron = value?.trim() || DEFAULT_CRON;
  const fields = cron.split(/\s+/);
  const minute = Number.parseInt(fields[0] ?? "", 10);
  const hour = Number.parseInt(fields[1] ?? "", 10);
  const valid = fields.length === 5
    && fields.slice(2).every((field) => field === "*")
    && Number.isInteger(minute) && minute >= 0 && minute <= 59
    && Number.isInteger(hour) && hour >= 0 && hour <= 23;
  return valid ? { cron, minute, hour } : { cron: DEFAULT_CRON, minute: 30, hour: 8 };
}

export function getPortfolioAutoSyncConfig(env: Partial<NodeJS.ProcessEnv> = process.env): PortfolioAutoSyncConfig {
  const timezone = env.PORTFOLIO_ACCOUNT_AUTO_SYNC_TZ?.trim() || DEFAULT_TIMEZONE;
  const retry = Number.parseInt(env.PORTFOLIO_ACCOUNT_AUTO_SYNC_RETRY_LIMIT ?? "", 10);
  return {
    enabled: parseBoolean(env.PORTFOLIO_ACCOUNT_AUTO_SYNC_ENABLED),
    cron: parseDailyCron(env.PORTFOLIO_ACCOUNT_AUTO_SYNC_CRON).cron,
    timezone: validTimezone(timezone) ? timezone : DEFAULT_TIMEZONE,
    retryLimit: Number.isFinite(retry) ? Math.max(0, Math.min(retry, 1)) : 1,
  };
}

export function getZonedParts(date: Date, timezone: string) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

function getTimezoneOffsetMs(date: Date, timezone: string) {
  const parts = getZonedParts(date, timezone);
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) - date.getTime();
}

function zonedDateTimeToUtc(year: number, month: number, day: number, hour: number, minute: number, timezone: string) {
  const guess = new Date(Date.UTC(year, month - 1, day, hour, minute));
  return new Date(guess.getTime() - getTimezoneOffsetMs(guess, timezone));
}

function pad(value: number) {
  return String(value).padStart(2, "0");
}

export function getPortfolioSchedule(now: Date, config: PortfolioAutoSyncConfig) {
  const parts = getZonedParts(now, config.timezone);
  const parsed = parseDailyCron(config.cron);
  const scheduledAt = zonedDateTimeToUtc(parts.year, parts.month, parts.day, parsed.hour, parsed.minute, config.timezone);
  const nextParts = scheduledAt > now
    ? parts
    : getZonedParts(zonedDateTimeToUtc(parts.year, parts.month, parts.day + 1, 12, 0, config.timezone), config.timezone);
  const nextRunAt = scheduledAt > now
    ? scheduledAt
    : zonedDateTimeToUtc(nextParts.year, nextParts.month, nextParts.day, parsed.hour, parsed.minute, config.timezone);
  return {
    dateKey: `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`,
    scheduledAt,
    nextRunAt,
    due: now >= scheduledAt,
  };
}

export function evaluatePortfolioAutoSyncRun(
  now: Date,
  config: PortfolioAutoSyncConfig,
  existing: PortfolioAutoSyncRunState | null,
) {
  const schedule = getPortfolioSchedule(now, config);
  if (!config.enabled) return { action: "disabled" as const, attempt: 0, schedule };
  if (!schedule.due) return { action: "not_due" as const, attempt: 0, schedule };
  if (!existing) return { action: "run" as const, attempt: 1, schedule };
  if (existing.status === "succeeded" || existing.status === "running") {
    return { action: "already_ran" as const, attempt: existing.attempt, schedule };
  }
  if (existing.attempt >= config.retryLimit + 1) {
    return { action: "retry_exhausted" as const, attempt: existing.attempt, schedule };
  }
  return { action: "run" as const, attempt: existing.attempt + 1, schedule };
}
