import { timingSafeEqual } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { startContentPipeline } from "@/lib/content-pipeline/content-pipeline-service";
import { HermesDailyLimitExceededError, getHermesUsageSummary } from "@/lib/hermes/hermes-usage";
import { createNaverDraftJobFromPipeline } from "@/lib/naver-drafts/naver-draft-jobs";
import type { StockBlogQualityGateResult } from "@/features/content-pipeline/content-pipeline-types";
import { evaluateStockBlogPublishQuality } from "@/lib/stock-blog/quality-gate";
import { resolveApproval } from "@/lib/repositories/approval-actions";
import {
  getExpectedHermesRunsForStockBlog,
  type StockBlogContentType,
  type StockBlogScheduleItem,
} from "@/lib/stock-blog/stock-blog-workflow";

export type StockBlogSchedulerRunnerMode = "mock" | "hermes-dry-run" | "hermes";
export type StockBlogSchedulerRunStatus =
  | "not_due"
  | "disabled"
  | "skipped"
  | "already_ran"
  | "succeeded"
  | "partial_failed"
  | "failed";

export type StockBlogSchedulerConfig = {
  enabled: boolean;
  timezone: string;
  runnerMode: StockBlogSchedulerRunnerMode;
  autoApprove: boolean;
  autoCreateDraftJob: boolean;
  lookbackMinutes: number;
};

export type StockBlogSchedulerPlanItem = StockBlogScheduleItem & {
  scheduleId: string;
  contentType: StockBlogContentType;
  label: string;
  cadence: string;
  scheduledTimeKst: string;
  objective: string;
  primaryAudience: string;
  recommendedRunnerMode: "hermes" | "hermes-dry-run" | "mock";
  scheduleHour: number;
  scheduleMinute: number;
  isDueToday: boolean;
  nextRunAt: string;
  expectedHermesRuns: number;
};

export type StockBlogSchedulerRunResult = {
  scheduleId?: string;
  contentType: StockBlogContentType;
  scheduleKey: string;
  scheduledFor: string;
  status: StockBlogSchedulerRunStatus;
  reason?: string;
  pipelineId?: string;
  approvalId?: string;
  naverDraftJobId?: string;
  hermesUsageBefore?: { used: number; remaining: number; limit: number };
  hermesUsageAfter?: { used: number; remaining: number; limit: number };
  qualityGate?: StockBlogQualityGateResult;
};

export type StockBlogSchedulerStatus = {
  ok: true;
  enabled: boolean;
  timezone: string;
  runnerMode: StockBlogSchedulerRunnerMode;
  autoApprove: boolean;
  autoCreateDraftJob: boolean;
  lookbackMinutes: number;
  now: string;
  plan: StockBlogSchedulerPlanItem[];
  nextRun: StockBlogSchedulerPlanItem | null;
  recentRuns: Array<{
    id: string;
    timestamp: string;
    summary: string | null;
    payload: Prisma.JsonValue;
  }>;
};

const DEFAULT_TIMEZONE = "Asia/Seoul";
const DEFAULT_LOOKBACK_MINUTES = 180;
const EVENT_TYPE = "StockBlogScheduledRun";

type StockBlogSchedulerDefinition = StockBlogScheduleItem & {
  scheduleId: string;
  weekdays: number[];
  scheduledTime: string;
  title: (date: string) => string;
  topic: string;
};

const STOCK_BLOG_SCHEDULE_DEFINITIONS: StockBlogSchedulerDefinition[] = [
  {
    scheduleId: "weekday-korea-daily-preview",
    contentType: "KOREA_DAILY_PREVIEW",
    label: "한국 증시 장전 브리핑",
    cadence: "평일",
    scheduledTimeKst: "09:00 KST",
    scheduledTime: "09:00",
    weekdays: [1, 2, 3, 4, 5],
    objective: "장 시작 전 전일 해외 변수와 당일 한국장 체크포인트를 정리합니다.",
    primaryAudience: "한국 주식 투자자",
    recommendedRunnerMode: "hermes",
    topic: "오늘 한국 주식시장 장전 현황과 체크포인트",
    title: (date) => `${date} 오늘의 한국 증시 장전 브리핑`,
  },
  {
    scheduleId: "weekday-korea-close-us-preview",
    contentType: "KOREA_MARKET_CLOSE_US_PREVIEW",
    label: "한국 마감·미국 장전 브리핑",
    cadence: "평일",
    scheduledTimeKst: "17:00 KST",
    scheduledTime: "17:00",
    weekdays: [1, 2, 3, 4, 5],
    objective: "한국 장 마감 흐름과 오늘 밤 미국장 관전 포인트를 연결합니다.",
    primaryAudience: "한국·미국 주식 병행 투자자",
    recommendedRunnerMode: "hermes",
    topic: "한국 증시 마감 흐름과 오늘 밤 미국장 전망",
    title: (date) => `${date} 한국장 마감 정리와 미국장 전망`,
  },
  {
    scheduleId: "friday-weekly-market-review",
    contentType: "WEEKLY_MARKET_REVIEW",
    label: "금요일 주간 시장 리뷰",
    cadence: "매주 금요일",
    scheduledTimeKst: "16:00 KST",
    scheduledTime: "16:00",
    weekdays: [5],
    objective: "이번 주 한국 증시 흐름과 다음 주로 이어질 체크포인트를 정리합니다.",
    primaryAudience: "주간 복기와 다음 주 전략을 준비하는 투자자",
    recommendedRunnerMode: "hermes",
    topic: "이번 주 한국 주식시장 흐름과 섹터별 체크포인트",
    title: (date) => `${date} 이번 주 한국 증시 리뷰`,
  },
  {
    scheduleId: "saturday-weekly-market-review",
    contentType: "WEEKLY_MARKET_REVIEW",
    label: "토요일 한국·미국 주간 정리",
    cadence: "매주 토요일",
    scheduledTimeKst: "09:00 KST",
    scheduledTime: "09:00",
    weekdays: [6],
    objective: "이번 주 한국·미국 증시 흐름, 수급, 섹터, 주요 이벤트를 주말용으로 정리합니다.",
    primaryAudience: "주말에 한 주를 복기하고 다음 주를 준비하는 투자자",
    recommendedRunnerMode: "hermes",
    topic: "이번 주 한국·미국 주식시장 흐름과 다음 주 체크포인트",
    title: (date) => `${date} 이번 주 한국·미국 증시 주간 정리`,
  },
  {
    scheduleId: "sunday-next-week-market-preview",
    contentType: "NEXT_WEEK_MARKET_PREVIEW",
    label: "다음 주 시장 프리뷰",
    cadence: "매주 일요일",
    scheduledTimeKst: "19:00 KST",
    scheduledTime: "19:00",
    weekdays: [0],
    objective: "다음 주 주요 경제 일정, 실적, 리스크와 투자자 체크리스트를 준비합니다.",
    primaryAudience: "일요일 저녁 다음 주 투자 계획을 세우는 투자자",
    recommendedRunnerMode: "hermes",
    topic: "다음 주 한국·미국 주식시장 주요 일정과 투자자 체크리스트",
    title: (date) => `${date} 다음 주 증시 일정과 체크포인트`,
  },
];

function parseBoolean(value: string | undefined, fallback: boolean) {
  if (value === undefined || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function parsePositiveInt(value: string | undefined, fallback: number) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function getConfiguredTimezone() {
  const timezone = process.env.STOCK_BLOG_SCHEDULER_TZ?.trim() || DEFAULT_TIMEZONE;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(new Date());
    return timezone;
  } catch {
    return DEFAULT_TIMEZONE;
  }
}

function getConfiguredRunnerMode(): StockBlogSchedulerRunnerMode {
  const value = process.env.STOCK_BLOG_SCHEDULER_RUNNER_MODE?.trim();
  if (value === "hermes" || value === "hermes-dry-run" || value === "mock") return value;
  return "mock";
}

export function getStockBlogSchedulerConfig(): StockBlogSchedulerConfig {
  return {
    enabled: parseBoolean(process.env.STOCK_BLOG_SCHEDULER_ENABLED, false),
    timezone: getConfiguredTimezone(),
    runnerMode: getConfiguredRunnerMode(),
    autoApprove: parseBoolean(process.env.STOCK_BLOG_SCHEDULER_AUTO_APPROVE, false),
    autoCreateDraftJob: parseBoolean(process.env.STOCK_BLOG_SCHEDULER_AUTO_CREATE_DRAFT, false),
    lookbackMinutes: parsePositiveInt(process.env.STOCK_BLOG_SCHEDULER_LOOKBACK_MINUTES, DEFAULT_LOOKBACK_MINUTES),
  };
}

function getZonedParts(date: Date, timezone: string) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
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
    weekday: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(String(parts.weekday)),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

function pad(value: number) {
  return String(value).padStart(2, "0");
}

function parseTime(value: string) {
  const [hour = "0", minute = "0"] = value.replace(" KST", "").split(":");
  return { hour: Number(hour), minute: Number(minute) };
}

function getTimezoneOffsetMs(date: Date, timezone: string) {
  const parts = getZonedParts(date, timezone);
  const utcFromZonedParts = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return utcFromZonedParts - date.getTime();
}

function zonedDateTimeToUtc(year: number, month: number, day: number, hour: number, minute: number, timezone: string) {
  const utcGuess = new Date(Date.UTC(year, month - 1, day, hour, minute, 0, 0));
  const offset = getTimezoneOffsetMs(utcGuess, timezone);
  return new Date(utcGuess.getTime() - offset);
}

function addDays(parts: ReturnType<typeof getZonedParts>, days: number, timezone: string) {
  return getZonedParts(zonedDateTimeToUtc(parts.year, parts.month, parts.day + days, 12, 0, timezone), timezone);
}

function appliesOnWeekday(definition: StockBlogSchedulerDefinition, weekday: number) {
  return definition.weekdays.includes(weekday);
}

function getScheduledAtForParts(definition: StockBlogSchedulerDefinition, parts: ReturnType<typeof getZonedParts>, timezone: string) {
  const { hour, minute } = parseTime(definition.scheduledTime);
  return zonedDateTimeToUtc(parts.year, parts.month, parts.day, hour, minute, timezone);
}

function getNextRunAt(definition: StockBlogSchedulerDefinition, now: Date, timezone: string) {
  const nowParts = getZonedParts(now, timezone);
  for (let offset = 0; offset < 10; offset += 1) {
    const candidateParts = addDays(nowParts, offset, timezone);
    if (!appliesOnWeekday(definition, candidateParts.weekday)) continue;
    const scheduledAt = getScheduledAtForParts(definition, candidateParts, timezone);
    if (scheduledAt > now) return scheduledAt;
  }
  return getScheduledAtForParts(definition, addDays(nowParts, 10, timezone), timezone);
}

function isDueToday(definition: StockBlogSchedulerDefinition, now: Date, timezone: string, lookbackMinutes: number) {
  const parts = getZonedParts(now, timezone);
  if (!appliesOnWeekday(definition, parts.weekday)) return false;
  const scheduledAt = getScheduledAtForParts(definition, parts, timezone);
  const elapsedMs = now.getTime() - scheduledAt.getTime();
  return elapsedMs >= 0 && elapsedMs <= lookbackMinutes * 60 * 1000;
}

function scheduleKey(definition: StockBlogSchedulerDefinition, scheduledAt: Date) {
  return `${definition.scheduleId}-${scheduledAt.toISOString().slice(0, 16).replace(/[-:T]/g, "")}`;
}

function schedulerEventId(key: string) {
  return `event-stock-scheduler-${key}`;
}

function briefDateLabel(now: Date, timezone: string) {
  const parts = getZonedParts(now, timezone);
  return `${String(parts.year).slice(2)}/${pad(parts.month)}/${pad(parts.day)}`;
}

function buildPipelineInput(definition: StockBlogSchedulerDefinition, runnerMode: StockBlogSchedulerRunnerMode, now: Date, timezone: string) {
  const date = briefDateLabel(now, timezone);
  return { topic: definition.topic, title: definition.title(date), channel: "blog", runnerMode };
}

function usageSnapshot(usage: Awaited<ReturnType<typeof getHermesUsageSummary>>) {
  return { used: usage.used, remaining: usage.remaining, limit: usage.limit };
}

async function writeSchedulerEvent(input: {
  key: string;
  contentType: StockBlogContentType;
  scheduledFor: string;
  status: StockBlogSchedulerRunStatus;
  summary: string;
  payload: Prisma.InputJsonObject;
}) {
  const id = schedulerEventId(input.key);
  return prisma.eventLog.upsert({
    where: { id },
    create: {
      id,
      type: EVENT_TYPE,
      timestamp: new Date(),
      payload: {
        scheduleKey: input.key,
        contentType: input.contentType,
        scheduledFor: input.scheduledFor,
        status: input.status,
        ...input.payload,
      },
      summary: input.summary,
    },
    update: {
      timestamp: new Date(),
      payload: {
        scheduleKey: input.key,
        contentType: input.contentType,
        scheduledFor: input.scheduledFor,
        status: input.status,
        ...input.payload,
      },
      summary: input.summary,
    },
  });
}

export function buildStockBlogSchedulerPlan(now = new Date(), config = getStockBlogSchedulerConfig()): StockBlogSchedulerPlanItem[] {
  return STOCK_BLOG_SCHEDULE_DEFINITIONS.map((definition) => {
    const time = parseTime(definition.scheduledTime);
    const nextRunAt = getNextRunAt(definition, now, config.timezone);
    return {
      ...definition,
      scheduleHour: time.hour,
      scheduleMinute: time.minute,
      isDueToday: isDueToday(definition, now, config.timezone, config.lookbackMinutes),
      nextRunAt: nextRunAt.toISOString(),
      expectedHermesRuns: getExpectedHermesRunsForStockBlog(definition.contentType),
    };
  });
}

export async function getStockBlogSchedulerStatus(now = new Date()): Promise<StockBlogSchedulerStatus> {
  const config = getStockBlogSchedulerConfig();
  const plan = buildStockBlogSchedulerPlan(now, config).sort((a, b) => new Date(a.nextRunAt).getTime() - new Date(b.nextRunAt).getTime());
  const recentRuns = await prisma.eventLog.findMany({
    where: { type: EVENT_TYPE },
    orderBy: { timestamp: "desc" },
    take: 8,
    select: { id: true, timestamp: true, summary: true, payload: true },
  });
  return {
    ok: true,
    enabled: config.enabled,
    timezone: config.timezone,
    runnerMode: config.runnerMode,
    autoApprove: config.autoApprove,
    autoCreateDraftJob: config.autoCreateDraftJob,
    lookbackMinutes: config.lookbackMinutes,
    now: now.toISOString(),
    plan,
    nextRun: plan[0] ?? null,
    recentRuns: recentRuns.map((run) => ({ id: run.id, timestamp: run.timestamp.toISOString(), summary: run.summary, payload: run.payload })),
  };
}

async function runOneSchedule(definition: StockBlogSchedulerDefinition, now: Date, config: StockBlogSchedulerConfig): Promise<StockBlogSchedulerRunResult> {
  const contentType = definition.contentType;
  const scheduledAt = getScheduledAtForParts(definition, getZonedParts(now, config.timezone), config.timezone);
  const key = scheduleKey(definition, scheduledAt);
  const id = schedulerEventId(key);
  const scheduledFor = scheduledAt.toISOString();

  const existing = await prisma.eventLog.findUnique({ where: { id } });
  if (existing) return { scheduleId: definition.scheduleId, contentType, scheduleKey: key, scheduledFor, status: "already_ran", reason: "이미 처리된 스케줄입니다." };

  await writeSchedulerEvent({
    key,
    contentType,
    scheduledFor,
    status: "skipped",
    summary: `${contentType} 자동 실행 시작`,
    payload: { phase: "started", runnerMode: config.runnerMode },
  });

  try {
    const hermesUsageBefore = usageSnapshot(await getHermesUsageSummary({ recentLimit: 4 }));
    if (config.runnerMode === "hermes") {
      const requiredRuns = getExpectedHermesRunsForStockBlog(contentType);
      if (hermesUsageBefore.remaining < requiredRuns) {
        const result: StockBlogSchedulerRunResult = {
          scheduleId: definition.scheduleId,
          contentType,
          scheduleKey: key,
          scheduledFor,
          status: "skipped",
          reason: `Hermes 남은 횟수 부족: ${requiredRuns}회 필요, ${hermesUsageBefore.remaining}회 남음`,
          hermesUsageBefore,
        };
        await writeSchedulerEvent({
          key,
          contentType,
          scheduledFor,
          status: "skipped",
          summary: `${contentType} 자동 실행 건너뜀 · Hermes 한도 부족`,
          payload: result as unknown as Prisma.InputJsonObject,
        });
        return result;
      }
    }

    const pipeline = await startContentPipeline(buildPipelineInput(definition, config.runnerMode, now, config.timezone));
    const approvalId = pipeline.approvalId ?? null;
    let naverDraftJobId: string | undefined;
    let status: StockBlogSchedulerRunStatus = "succeeded";
    const notes: string[] = [];
    const qualityGate = pipeline.qualityGate ?? evaluateStockBlogPublishQuality({
      pipeline,
      requireRealReferences: config.runnerMode === "hermes",
    });
    const qualityBlocked = config.runnerMode === "hermes" && !qualityGate.ok;
    if (qualityBlocked) {
      status = "partial_failed";
      notes.push(`품질 게이트 차단: ${qualityGate.status} · ${qualityGate.reasons.join(" / ")}`);
    }

    if (!qualityBlocked && config.autoApprove && approvalId && pipeline.status === "director_approval") {
      await resolveApproval({
        approvalId,
        status: "승인 완료",
        decisionReason: "Stock Blog Scheduler 자동 승인 · 네이버 임시저장 준비",
      });
    } else if (config.autoApprove) {
      notes.push(qualityBlocked ? "품질 게이트 실패로 자동 승인 차단" : "자동 승인 조건 미충족");
    }

    if (!qualityBlocked && config.autoCreateDraftJob) {
      try {
        const job = await createNaverDraftJobFromPipeline({ contentPipelineId: pipeline.id, approvalId });
        naverDraftJobId = job.id;
      } catch (error) {
        status = "partial_failed";
        notes.push(error instanceof Error ? error.message : "네이버 임시저장 job 생성 실패");
      }
    }

    const hermesUsageAfter = usageSnapshot(await getHermesUsageSummary({ recentLimit: 4 }));
    const result: StockBlogSchedulerRunResult = {
      scheduleId: definition.scheduleId,
      contentType,
      scheduleKey: key,
      scheduledFor,
      status,
      reason: notes.join(" · ") || undefined,
      pipelineId: pipeline.id,
      approvalId: approvalId ?? undefined,
      naverDraftJobId,
      hermesUsageBefore,
      hermesUsageAfter,
      qualityGate,
    };
    await writeSchedulerEvent({
      key,
      contentType,
      scheduledFor,
      status,
      summary: `${contentType} 자동 실행 ${status === "succeeded" ? "완료" : "부분 완료"}`,
      payload: result as unknown as Prisma.InputJsonObject,
    });
    return result;
  } catch (error) {
    const reason = error instanceof HermesDailyLimitExceededError ? error.message : error instanceof Error ? error.message : "알 수 없는 스케줄러 오류";
    const result: StockBlogSchedulerRunResult = { scheduleId: definition.scheduleId, contentType, scheduleKey: key, scheduledFor, status: "failed", reason };
    await writeSchedulerEvent({
      key,
      contentType,
      scheduledFor,
      status: "failed",
      summary: `${contentType} 자동 실행 실패`,
      payload: result as unknown as Prisma.InputJsonObject,
    });
    return result;
  }
}

export async function runStockBlogSchedulerTick(now = new Date()) {
  const config = getStockBlogSchedulerConfig();
  if (!config.enabled) return { ok: true, status: "disabled" as const, config, results: [] as StockBlogSchedulerRunResult[] };
  const plan = buildStockBlogSchedulerPlan(now, config);
  const due = plan.filter((item) => item.isDueToday);
  if (due.length === 0) return { ok: true, status: "not_due" as const, config, results: [] as StockBlogSchedulerRunResult[] };
  const results: StockBlogSchedulerRunResult[] = [];
  for (const item of due) {
    const definition = STOCK_BLOG_SCHEDULE_DEFINITIONS.find((candidate) => candidate.scheduleId === item.scheduleId);
    if (definition) results.push(await runOneSchedule(definition, now, config));
  }
  return { ok: true, status: "processed" as const, config, results };
}

export function verifyStockBlogSchedulerKey(value: string | null) {
  const expected = process.env.AGENT_API_KEY?.trim();
  if (!expected || !value) return false;
  const a = Buffer.from(value);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
