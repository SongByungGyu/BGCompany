import { timingSafeEqual } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { startContentPipeline } from "@/lib/content-pipeline/content-pipeline-service";
import { HermesDailyLimitExceededError, getHermesUsageSummary } from "@/lib/hermes/hermes-usage";
import { createNaverDraftJobFromPipeline, getPublishCircuitBreaker } from "@/lib/naver-drafts/naver-draft-jobs";
import type { StockBlogQualityGateResult } from "@/features/content-pipeline/content-pipeline-types";
import { evaluateStockBlogPublishQuality } from "@/lib/stock-blog/quality-gate";
import {
  evaluateStockBlogSchedulerRetry,
  isStockContentQualityFailure,
  isStockReferencePreflightFailure,
  shouldClearRecoverablePipelineCircuitBreaker,
} from "@/lib/stock-blog/stock-blog-scheduler-policy";
import { buildStockBlogEditorialTitle } from "@/lib/stock-blog/stock-blog-title";
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
  | "running"
  | "deferred"
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
  autoPublish: boolean;
  firstAutoPublishAt: string | null;
  autoPublishCanaryLimit: number;
  autoPublishRetryLimit: number;
  lookbackMinutes: number;
  maxRetries: number;
  retryDelayMinutes: number;
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
  attempt?: number;
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
  autoPublish: boolean;
  firstAutoPublishAt: string | null;
  autoPublishCanaryLimit: number;
  autoPublishRetryLimit: number;
  publishCircuitBreaker: { active: boolean; message: string | null; updatedAt: string | null };
  lookbackMinutes: number;
  maxRetries: number;
  retryDelayMinutes: number;
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
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_RETRY_DELAY_MINUTES = 10;
const EVENT_TYPE = "StockBlogScheduledRun";
const PUBLISH_CIRCUIT_BREAKER_EVENT_ID = "event-stock-auto-publish-circuit-breaker";

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
    scheduledTimeKst: "08:30 KST",
    scheduledTime: "08:30",
    weekdays: [1, 2, 3, 4, 5],
    objective: "장 시작 전 전일 해외 변수와 당일 한국장 체크포인트를 정리합니다.",
    primaryAudience: "한국 주식 투자자",
    recommendedRunnerMode: "hermes",
    topic: "오늘 한국 증시 변동 원인과 코스피·반도체·원달러 환율 영향",
    title: (date) => `${date} 오늘 한국장 핵심 변수: 코스피·반도체·원달러 환율`,
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
    topic: "한국 증시 마감 원인과 오늘 밤 나스닥·미국 금리·반도체 영향",
    title: (date) => `${date} 오늘 미국장 핵심 변수: 나스닥·금리·반도체`,
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
    topic: "이번 주 한국·미국 증시 변동 원인과 다음 주 핵심 일정·주도 업종",
    title: (date) => `${date} 이번 주 증시를 움직인 원인과 다음 주 핵심 일정`,
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
    topic: "다음 주 한국·미국 증시에 영향을 줄 경제 일정·실적·금리 변수",
    title: (date) => `${date} 다음 주 증시를 움직일 일정과 핵심 변수`,
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

function parseNonNegativeInt(value: string | undefined, fallback: number) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function parseOptionalDate(value: string | undefined) {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return Number.isFinite(Date.parse(trimmed)) ? new Date(trimmed).toISOString() : null;
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
    autoPublish: parseBoolean(process.env.STOCK_BLOG_SCHEDULER_AUTO_PUBLISH, false),
    firstAutoPublishAt: parseOptionalDate(process.env.STOCK_BLOG_FIRST_AUTO_PUBLISH_AT),
    autoPublishCanaryLimit: parsePositiveInt(process.env.STOCK_BLOG_AUTO_PUBLISH_CANARY_LIMIT, 1),
    autoPublishRetryLimit: parseNonNegativeInt(process.env.STOCK_BLOG_AUTO_PUBLISH_RETRY_LIMIT, 0),
    lookbackMinutes: parsePositiveInt(process.env.STOCK_BLOG_SCHEDULER_LOOKBACK_MINUTES, DEFAULT_LOOKBACK_MINUTES),
    maxRetries: parsePositiveInt(process.env.STOCK_BLOG_SCHEDULER_MAX_RETRIES, DEFAULT_MAX_RETRIES),
    retryDelayMinutes: parsePositiveInt(process.env.STOCK_BLOG_SCHEDULER_RETRY_DELAY_MINUTES, DEFAULT_RETRY_DELAY_MINUTES),
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
  return {
    topic: definition.topic,
    title: buildStockBlogEditorialTitle({
      template: definition.contentType,
      marketDate: date,
      sourceTitle: definition.title(date),
    }),
    channel: "blog",
    runnerMode,
    contentType: definition.contentType,
  };
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

async function activateSchedulerPublishCircuitBreaker(input: { status: string; reason: string; scheduleKey: string }) {
  await prisma.eventLog.upsert({
    where: { id: PUBLISH_CIRCUIT_BREAKER_EVENT_ID },
    create: {
      id: PUBLISH_CIRCUIT_BREAKER_EVENT_ID,
      type: "StockBlogPublishCircuitBreaker",
      timestamp: new Date(),
      summary: "첫 자동 발행이 실패해 자동 발행이 일시 중지되었습니다.",
      payload: { active: true, ...input },
    },
    update: {
      timestamp: new Date(),
      summary: "첫 자동 발행이 실패해 자동 발행이 일시 중지되었습니다.",
      payload: { active: true, ...input },
    },
  });
}

function eventPayload(value: Prisma.JsonValue): Record<string, Prisma.JsonValue> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, Prisma.JsonValue>
    : {};
}

async function clearRecoverablePipelineCircuitBreaker(scheduleKey: string) {
  const existing = await prisma.eventLog.findUnique({
    where: { id: PUBLISH_CIRCUIT_BREAKER_EVENT_ID },
  });
  if (!existing) return false;

  const payload = eventPayload(existing.payload);
  const status = typeof payload.status === "string" ? payload.status : "";
  const reason = typeof payload.reason === "string" ? payload.reason : "";
  if (!shouldClearRecoverablePipelineCircuitBreaker({
    active: payload.active === true,
    status,
    reason,
  })) {
    return false;
  }

  await prisma.eventLog.update({
    where: { id: PUBLISH_CIRCUIT_BREAKER_EVENT_ID },
    data: {
      timestamp: new Date(),
      summary: "시장 참고자료 사전검증 실패로 잘못 활성화된 자동 발행 차단을 해제했습니다.",
      payload: {
        ...payload,
        active: false,
        status: "pipeline_recovery_cleared",
        clearedAt: new Date().toISOString(),
        recoveredByScheduleKey: scheduleKey,
      } as Prisma.InputJsonObject,
    },
  });
  return true;
}

function retryState(existing: Awaited<ReturnType<typeof prisma.eventLog.findUnique>>, now: Date, config: StockBlogSchedulerConfig) {
  const payload = existing ? eventPayload(existing.payload) : {};
  const reason = typeof payload.reason === "string" ? payload.reason : "";
  const qualityGate = payload.qualityGate;
  const qualityGateFailed = Boolean(
    qualityGate
      && typeof qualityGate === "object"
      && !Array.isArray(qualityGate)
      && qualityGate.ok === false,
  );
  const retryableGenerationFailure = qualityGateFailed
    || isStockContentQualityFailure(reason);
  return evaluateStockBlogSchedulerRetry({
    exists: Boolean(existing),
    status: typeof payload.status === "string" ? payload.status : "",
    previousAttempt: typeof payload.attempt === "number" ? payload.attempt : 1,
    elapsedMs: existing ? now.getTime() - existing.timestamp.getTime() : 0,
    autoPublish: config.autoPublish,
    autoPublishRetryLimit: config.autoPublishRetryLimit,
    maxRetries: config.maxRetries,
    retryDelayMinutes: config.retryDelayMinutes,
    referencePreflightFailure: isStockReferencePreflightFailure(reason),
    retryableGenerationFailure,
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
  const publishCircuitBreaker = await getPublishCircuitBreaker();
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
    autoPublish: config.autoPublish,
    firstAutoPublishAt: config.firstAutoPublishAt,
    autoPublishCanaryLimit: config.autoPublishCanaryLimit,
    autoPublishRetryLimit: config.autoPublishRetryLimit,
    publishCircuitBreaker,
    lookbackMinutes: config.lookbackMinutes,
    maxRetries: config.maxRetries,
    retryDelayMinutes: config.retryDelayMinutes,
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
  const scheduledParts = getZonedParts(scheduledAt, config.timezone);
  const marketDate = `${scheduledParts.year}-${pad(scheduledParts.month)}-${pad(scheduledParts.day)}`;
  const publishKey = `${contentType}:${marketDate}:${definition.scheduledTime}`;

  if (config.autoPublish) {
    await clearRecoverablePipelineCircuitBreaker(key);
    const circuit = await getPublishCircuitBreaker();
    if (circuit.active) {
      return { scheduleId: definition.scheduleId, contentType, scheduleKey: key, scheduledFor, status: "skipped", reason: circuit.message ?? "자동 발행 circuit breaker 활성화" };
    }
    if (config.firstAutoPublishAt && now.getTime() < Date.parse(config.firstAutoPublishAt)) {
      return { scheduleId: definition.scheduleId, contentType, scheduleKey: key, scheduledFor, status: "not_due", reason: "첫 자동 발행 예약 시각 이전" };
    }
  }

  const existing = await prisma.eventLog.findUnique({ where: { id } });
  const retry = retryState(existing, now, config);
  if (!retry.allowed) return { scheduleId: definition.scheduleId, contentType, scheduleKey: key, scheduledFor, status: "already_ran", attempt: retry.attempt, reason: retry.reason };
  const attempt = retry.attempt;

  await writeSchedulerEvent({
    key,
    contentType,
    scheduledFor,
    status: "running",
    summary: `${contentType} 자동 실행 시작`,
    payload: { phase: "started", runnerMode: config.runnerMode, attempt },
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
          status: "deferred",
          attempt,
          reason: `Hermes 남은 횟수 부족: ${requiredRuns}회 필요, ${hermesUsageBefore.remaining}회 남음`,
          hermesUsageBefore,
        };
        await writeSchedulerEvent({
          key,
          contentType,
          scheduledFor,
          status: "deferred",
          summary: `${contentType} 자동 실행 대기 · Hermes 한도 부족`,
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
    const qualityGate = evaluateStockBlogPublishQuality({
      pipeline,
      requireRealReferences: config.runnerMode === "hermes",
    });
    const qaBlocked = pipeline.qaResult?.publishReadiness === "blocked"
      || pipeline.qaResult?.finalRecommendation === "block";
    const qualityBlocked = (config.runnerMode === "hermes" && !qualityGate.ok) || qaBlocked;
    if (qualityBlocked) {
      status = "failed";
      const qualityReason = qaBlocked
        ? `QA 자동 승인 차단: ${pipeline.qaResult?.reason ?? "QA가 게시 차단을 권고함"}`
        : `품질 게이트 차단: ${qualityGate.status} · ${qualityGate.reasons.join(" / ")}`;
      notes.push(`STOCK_CONTENT_QUALITY_FAILED: ${qualityReason}`);
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
        const job = await createNaverDraftJobFromPipeline({
          contentPipelineId: pipeline.id,
          approvalId,
          allowPublish: config.autoPublish,
          publishKey: config.autoPublish ? publishKey : null,
          marketDate: config.autoPublish ? marketDate : null,
          scheduleSlot: config.autoPublish ? definition.scheduledTime : null,
        });
        naverDraftJobId = job.id;
      } catch (error) {
        status = "partial_failed";
        const reason = error instanceof Error ? error.message : "네이버 임시저장 job 생성 실패";
        notes.push(reason);
        if (config.autoPublish) await activateSchedulerPublishCircuitBreaker({ status: "publish_blocked", reason, scheduleKey: key });
      }
    }

    const hermesUsageAfter = usageSnapshot(await getHermesUsageSummary({ recentLimit: 4 }));
    const result: StockBlogSchedulerRunResult = {
      scheduleId: definition.scheduleId,
      contentType,
      scheduleKey: key,
      scheduledFor,
      status,
      attempt,
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
    const referencePreflightFailure = isStockReferencePreflightFailure(reason);
    const capacityDeferred = error instanceof HermesDailyLimitExceededError;
    const qualityGate = error && typeof error === "object" && "qualityGate" in error
      ? (error as { qualityGate?: StockBlogQualityGateResult }).qualityGate
      : undefined;
    const result: StockBlogSchedulerRunResult = {
      scheduleId: definition.scheduleId,
      contentType,
      scheduleKey: key,
      scheduledFor,
      status: capacityDeferred ? "deferred" : "failed",
      attempt,
      reason,
      qualityGate,
    };
    await writeSchedulerEvent({
      key,
      contentType,
      scheduledFor,
      status: result.status,
      summary: capacityDeferred
        ? `${contentType} 자동 실행 대기 · Hermes 한도 부족`
        : `${contentType} 자동 실행 실패`,
      payload: {
        ...(result as unknown as Prisma.InputJsonObject),
        failurePhase: referencePreflightFailure ? "reference_preflight" : capacityDeferred ? "capacity" : "runtime",
        retryable: referencePreflightFailure || capacityDeferred,
      },
    });
    if (config.autoPublish && !referencePreflightFailure && !capacityDeferred) {
      await activateSchedulerPublishCircuitBreaker({ status: "failed", reason, scheduleKey: key });
    }
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

export async function runStockBlogSchedulerRecovery(scheduleId: string, now = new Date()) {
  const config = getStockBlogSchedulerConfig();
  if (!config.enabled) {
    return {
      ok: true,
      status: "disabled" as const,
      config,
      results: [] as StockBlogSchedulerRunResult[],
    };
  }

  const definition = STOCK_BLOG_SCHEDULE_DEFINITIONS.find(
    (candidate) => candidate.scheduleId === scheduleId,
  );
  if (!definition) {
    return {
      ok: false,
      status: "invalid_schedule" as const,
      error: "알 수 없는 stock blog scheduleId입니다.",
      config,
      results: [] as StockBlogSchedulerRunResult[],
    };
  }

  const parts = getZonedParts(now, config.timezone);
  const scheduledAt = getScheduledAtForParts(definition, parts, config.timezone);
  if (!appliesOnWeekday(definition, parts.weekday) || scheduledAt > now) {
    return {
      ok: true,
      status: "not_due" as const,
      config,
      results: [] as StockBlogSchedulerRunResult[],
    };
  }

  const result = await runOneSchedule(definition, now, config);
  return {
    ok: true,
    status: "processed" as const,
    config,
    results: [result],
  };
}

export function verifyStockBlogSchedulerKey(value: string | null) {
  const expected = process.env.AGENT_API_KEY?.trim();
  if (!expected || !value) return false;
  const a = Buffer.from(value);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
