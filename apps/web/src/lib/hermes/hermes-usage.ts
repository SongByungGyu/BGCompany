import { prisma } from "@/lib/db";

const DEFAULT_DAILY_LIMIT = 5;
const DEFAULT_TIMEZONE = "Asia/Seoul";
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

type AgentRunMetadata = Record<string, unknown> | null;
type MetadataPath = string | string[];

export type HermesUsageRecentRun = {
  id: string;
  agentId: string;
  status: string;
  createdAt: string;
  durationMs: number | null;
  title: string | null;
  parseStatus: string | null;
  provider: string | null;
};

export type HermesUsageSummary = {
  ok: true;
  date: string;
  timezone: string;
  limit: number;
  used: number;
  remaining: number;
  blocked: boolean;
  recentRuns: HermesUsageRecentRun[];
};

export class HermesDailyLimitExceededError extends Error {
  code = "HERMES_DAILY_LIMIT_EXCEEDED";
  status = 429;
  usage: HermesUsageSummary;

  constructor(usage: HermesUsageSummary) {
    super("오늘 Hermes 실행 가능 횟수를 모두 사용했습니다.");
    this.name = "HermesDailyLimitExceededError";
    this.usage = usage;
  }
}

function parsePositiveInt(value: string | undefined, fallback: number) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function getConfiguredTimezone() {
  const timezone = process.env.HERMES_DAILY_RUN_TZ?.trim() || DEFAULT_TIMEZONE;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(new Date());
    return timezone;
  } catch {
    return DEFAULT_TIMEZONE;
  }
}

export function getHermesDailyRunLimit() {
  return parsePositiveInt(process.env.HERMES_DAILY_RUN_LIMIT, DEFAULT_DAILY_LIMIT);
}

export function getHermesDailyRunTimezone() {
  return getConfiguredTimezone();
}

function getZonedParts(date: Date, timezone: string) {
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
  const utcFromZonedParts = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  return utcFromZonedParts - date.getTime();
}

function zonedMidnightToUtc(year: number, month: number, day: number, timezone: string) {
  const utcGuess = new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
  const offset = getTimezoneOffsetMs(utcGuess, timezone);
  return new Date(utcGuess.getTime() - offset);
}

function getDailyWindow(now = new Date()) {
  const timezone = getHermesDailyRunTimezone();
  const parts = getZonedParts(now, timezone);
  const start = zonedMidnightToUtc(parts.year, parts.month, parts.day, timezone);
  let end = zonedMidnightToUtc(parts.year, parts.month, parts.day + 1, timezone);
  if (end <= start) end = new Date(start.getTime() + ONE_DAY_MS);
  const date = [
    String(parts.year).padStart(4, "0"),
    String(parts.month).padStart(2, "0"),
    String(parts.day).padStart(2, "0"),
  ].join("-");
  return { date, timezone, start, end };
}

function getMetadataPathValue(metadata: AgentRunMetadata, path: MetadataPath) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const keys = Array.isArray(path) ? path : [path];
  let current: unknown = metadata;
  for (const key of keys) {
    if (!current || typeof current !== "object" || Array.isArray(current)) return null;
    current = (current as Record<string, unknown>)[key];
  }
  return current ?? null;
}

function getMetadataStringValue(metadata: AgentRunMetadata, paths: MetadataPath[]) {
  for (const path of paths) {
    const value = getMetadataPathValue(metadata, path);
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function getMetadataNumberValue(metadata: AgentRunMetadata, paths: MetadataPath[]) {
  for (const path of paths) {
    const value = getMetadataPathValue(metadata, path);
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
    if (typeof value === "string" && value.trim()) {
      const parsed = Number.parseFloat(value);
      if (Number.isFinite(parsed) && parsed >= 0) return parsed;
    }
  }
  return null;
}

function getDurationMs(startedAt: Date | null, completedAt: Date | null) {
  if (!startedAt || !completedAt) return null;
  const duration = completedAt.getTime() - startedAt.getTime();
  return Number.isFinite(duration) && duration >= 0 ? duration : null;
}

function getHermesRunDurationMs(metadata: AgentRunMetadata, startedAt: Date | null, completedAt: Date | null) {
  return getMetadataNumberValue(metadata, [
    ["plannerResult", "durationMs"],
    ["hermesResponse", "durationMs"],
    "durationMs",
  ]) ?? getDurationMs(startedAt, completedAt);
}

export async function getHermesUsageSummary(options?: { recentLimit?: number; now?: Date }): Promise<HermesUsageSummary> {
  const limit = getHermesDailyRunLimit();
  const recentLimit = options?.recentLimit ?? 8;
  const { date, timezone, start, end } = getDailyWindow(options?.now);

  const where = {
    mode: "hermes",
    triggerSource: "content-pipeline",
    createdAt: {
      gte: start,
      lt: end,
    },
  } as const;

  const [used, recentRuns] = await Promise.all([
    prisma.agentRun.count({ where }),
    prisma.agentRun.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: recentLimit,
      select: {
        id: true,
        employeeId: true,
        status: true,
        startedAt: true,
        completedAt: true,
        createdAt: true,
        resultSummary: true,
        metadata: true,
      },
    }),
  ]);

  const remaining = Math.max(limit - used, 0);

  return {
    ok: true,
    date,
    timezone,
    limit,
    used,
    remaining,
    blocked: remaining <= 0,
    recentRuns: recentRuns.map((run) => {
      const metadata = run.metadata as AgentRunMetadata;
      return {
        id: run.id,
        agentId: run.employeeId,
        status: run.status,
        createdAt: run.createdAt.toISOString(),
        durationMs: getHermesRunDurationMs(metadata, run.startedAt, run.completedAt),
        title: getMetadataStringValue(metadata, [
          ["plannerResult", "title"],
          ["plannerResult", "summary"],
          ["hermesResponse", "title"],
          ["hermesResponse", "summary"],
          "contentPipelineTitle",
          "title",
          "topic",
        ]) ?? run.resultSummary,
        parseStatus: getMetadataStringValue(metadata, [
          ["plannerResult", "parseStatus"],
          ["hermesResponse", "parseStatus"],
          "parseStatus",
        ]),
        provider: getMetadataStringValue(metadata, [
          ["plannerResult", "provider"],
          ["hermesResponse", "provider"],
          "provider",
        ]),
      };
    }),
  };
}

export async function assertHermesDailyRunAvailable() {
  const usage = await getHermesUsageSummary({ recentLimit: 5 });
  if (usage.blocked) throw new HermesDailyLimitExceededError(usage);
  return usage;
}
