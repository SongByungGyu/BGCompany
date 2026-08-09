export type PaperTradingSchedulerConfig = {
  enabled: boolean;
  cron: string;
  timezone: string;
  retryLimit: number;
  autoInitialize: boolean;
  trialStartMarketDate: string | null;
  trialEndMarketDate: string | null;
};

function enabled(value: string | undefined, fallback = false) {
  if (value == null) return fallback;
  return value.trim().toLowerCase() === "true";
}

function marketDate(value: string | undefined) {
  const normalized = value?.trim() ?? "";
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) && !Number.isNaN(Date.parse(`${normalized}T00:00:00.000Z`)) ? normalized : null;
}

export function getPaperTradingSchedulerConfig(env: NodeJS.ProcessEnv = process.env): PaperTradingSchedulerConfig {
  const timezone = env.PAPER_AUTO_SCHEDULER_TZ?.trim() || "Asia/Seoul";
  const retry = Number.parseInt(env.PAPER_AUTO_SCHEDULER_RETRY_LIMIT ?? "1", 10);
  const cron = parseDailyCron(env.PAPER_AUTO_SCHEDULER_CRON ?? "20 7 * * *").cron;
  return {
    enabled: enabled(env.PAPER_AUTO_SCHEDULER_ENABLED),
    autoInitialize: enabled(env.PAPER_AUTO_INITIALIZE, true),
    cron,
    timezone,
    retryLimit: Number.isFinite(retry) ? Math.max(0, Math.min(retry, 1)) : 1,
    trialStartMarketDate: marketDate(env.PAPER_TRIAL_START_DATE),
    trialEndMarketDate: marketDate(env.PAPER_TRIAL_END_DATE),
  };
}

export function evaluatePaperTradingTrial(marketDateValue: string, config = getPaperTradingSchedulerConfig()) {
  if (config.trialStartMarketDate && marketDateValue < config.trialStartMarketDate) {
    return { action: "waiting" as const, shouldPauseAfterRun: false };
  }
  return {
    action: "run" as const,
    shouldPauseAfterRun: Boolean(config.trialEndMarketDate && marketDateValue >= config.trialEndMarketDate),
  };
}

export function getPaperTradingSchedule(now = new Date(), config = getPaperTradingSchedulerConfig()) {
  const parts = zonedParts(now, config.timezone);
  const parsed = parseDailyCron(config.cron);
  const scheduledAt = zonedDateTimeToUtc(parts.year, parts.month, parts.day, parsed.hour, parsed.minute, config.timezone);
  const nextParts = scheduledAt > now
    ? parts
    : zonedParts(zonedDateTimeToUtc(parts.year, parts.month, parts.day + 1, 12, 0, config.timezone), config.timezone);
  return {
    dateKey: `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`,
    scheduledAt,
    nextRunAt: scheduledAt > now ? scheduledAt : zonedDateTimeToUtc(nextParts.year, nextParts.month, nextParts.day, parsed.hour, parsed.minute, config.timezone),
    due: now >= scheduledAt,
  };
}

function parseDailyCron(value: string) {
  const fields = value.trim().split(/\s+/);
  const minute = Number.parseInt(fields[0] ?? "", 10);
  const hour = Number.parseInt(fields[1] ?? "", 10);
  const valid = fields.length === 5 && fields.slice(2).every((field) => field === "*")
    && Number.isInteger(minute) && minute >= 0 && minute <= 59
    && Number.isInteger(hour) && hour >= 0 && hour <= 23;
  return valid ? { cron: value.trim(), minute, hour } : { cron: "20 7 * * *", minute: 20, hour: 7 };
}

function zonedParts(date: Date, timezone: string) {
  const formatter = new Intl.DateTimeFormat("en-US", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
  const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
  return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day), hour: Number(parts.hour), minute: Number(parts.minute), second: Number(parts.second) };
}

function zonedDateTimeToUtc(year: number, month: number, day: number, hour: number, minute: number, timezone: string) {
  const guess = new Date(Date.UTC(year, month - 1, day, hour, minute));
  const parts = zonedParts(guess, timezone);
  const offset = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) - guess.getTime();
  return new Date(guess.getTime() - offset);
}

export function decidePaperTradingSchedulerRun(input: {
  now: Date;
  config: PaperTradingSchedulerConfig;
  previous: null | { status: string; attempt: number };
}) {
  const schedule = getPaperTradingSchedule(input.now, input.config);
  if (!input.config.enabled) return { action: "disabled" as const, attempt: 0, schedule };
  if (!schedule.due) return { action: "not_due" as const, attempt: 0, schedule };
  if (!input.previous) return { action: "run" as const, attempt: 1, schedule };
  if (["succeeded", "running", "paused", "killed", "trial_waiting"].includes(input.previous.status)) {
    return { action: "already_ran" as const, attempt: input.previous.attempt, schedule };
  }
  if (input.previous.attempt >= input.config.retryLimit + 1) {
    return { action: "retry_exhausted" as const, attempt: input.previous.attempt, schedule };
  }
  return { action: "run" as const, attempt: input.previous.attempt + 1, schedule };
}
