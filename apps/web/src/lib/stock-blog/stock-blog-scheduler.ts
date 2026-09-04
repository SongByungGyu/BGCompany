import { randomUUID, timingSafeEqual } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  findContentPipelineByOperationalAttempt,
  startContentPipelineFromTrustedInput,
} from "@/lib/content-pipeline/content-pipeline-service";
import type { ContentPipelineInput } from "@/lib/content-pipeline/content-pipeline-input";
import { HermesDailyLimitExceededError, getHermesUsageSummary } from "@/lib/hermes/hermes-usage";
import { createNaverDraftJobFromPipeline, getPublishCircuitBreaker } from "@/lib/naver-drafts/naver-draft-jobs";
import { getNaverDraftLateTtlMinutes } from "@/lib/naver-drafts/naver-draft-schedule-policy";
import type { ContentPipelineRun, StockBlogQualityGateResult } from "@/features/content-pipeline/content-pipeline-types";
import { evaluateStockBlogPublishQuality, evaluateStockBlogReferences } from "@/lib/stock-blog/quality-gate";
import { collectStockBlogReferences } from "@/lib/stock-blog/references/reference-adapter";
import type { ReferenceBundle, ReferenceItem } from "@/lib/stock-blog/references/reference-types";
import {
  largeCapEventsToReferenceItems,
  scanLargeCapDisclosureEvents,
  type LargeCapDisclosureScanResult,
} from "@/lib/stock-blog/large-cap-disclosure-monitor";
import {
  buildStockBlogLegacyPublishKeyAliases,
  buildStockBlogLogicalPublishKey,
  buildStockBlogLogicalScheduleKey,
  createEmptyStockBlogRetryV2State,
  evaluateStockBlogRecoveryDate,
  evaluateStockBlogPhaseBudget,
  evaluateStockBlogRetryV2Claim,
  isStockContentQualityFailure,
  isStockReferencePreflightFailure,
  parseStockBlogRetryV2,
  reopenStockBlogRetryV2ContentGeneration,
  resolveStockBlogRecoveryPublishTime,
  requestStockBlogRetryV2ReferenceRefresh,
  settleStockBlogRetryV2Claim,
  STOCK_BLOG_MANUAL_RECOVERY_GENERATION_LIMIT,
  STOCK_BLOG_RETRY_PHASE_LIMITS,
  shouldClearRecoverablePipelineCircuitBreaker,
  type StockBlogRetryPhase,
  type StockBlogRetryV2State,
} from "@/lib/stock-blog/stock-blog-scheduler-policy";
import { buildStockBlogEditorialTitle } from "@/lib/stock-blog/stock-blog-title";
import {
  buildHolidaySearchStudyPlan,
  getHolidaySearchStudyPublishKey,
} from "@/lib/stock-blog/holiday-search-study";
import {
  buildMarketDataFallbackStudyPlan,
  getMarketDataFallbackStudyPublishKey,
} from "@/lib/stock-blog/market-data-fallback-study";
import { isKisOverseasDegradedCutoffReached } from "@/lib/stock-blog/references/kis-overseas-degraded-policy";
import {
  addIsoDays,
  evaluateStockBlogMarketSession,
  getKrxMarketSession,
  getNyseMarketSession,
  getStockBlogMarketDependency,
  type StockBlogMarketSessionDecision,
  type StockMarketSession,
} from "@/lib/stock-blog/market-session-policy";
import {
  qualifiesForConditionalInvestmentStudy,
  selectInvestmentStudyTopic,
  type InvestmentStudyEditorialAngle,
  type InvestmentStudyTopicSelection,
} from "@/lib/stock-blog/investment-study-topic";
import { resolveApproval } from "@/lib/repositories/approval-actions";
import { recordFailureFromPersistedEvent } from "@/lib/operational-learning/operational-learning-service";
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
  largeCapEventsEnabled: boolean;
  weekdayInvestmentStudyEnabled: boolean;
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
  referenceAttempt?: number;
  generationAttempt?: number;
  reason?: string;
  pipelineId?: string;
  approvalId?: string;
  naverDraftJobId?: string;
  hermesUsageBefore?: { used: number; remaining: number; limit: number };
  hermesUsageAfter?: { used: number; remaining: number; limit: number };
  qualityGate?: StockBlogQualityGateResult;
  officialEventCount?: number;
  officialProviders?: LargeCapDisclosureScanResult["providers"];
  studyTopicMode?: InvestmentStudyTopicSelection["mode"];
  studyIssueScore?: number;
  studyIssueReasons?: string[];
  marketSession?: StockMarketSession;
  holidaySearchReplacement?: boolean;
  dataFailureStudyFallback?: boolean;
  replacementContentType?: "INVESTMENT_STUDY";
  nextMarketOpenDate?: string;
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
  largeCapEventsEnabled: boolean;
  weekdayInvestmentStudyEnabled: boolean;
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
  publishTime?: string;
  maxAttempts?: number;
  dataFailureFallback?: "investment-study";
  dataFailureFallbackAfterKst?: string;
  referenceMaxAttempts?: number;
  generationMaxAttempts?: number;
  title: (date: string) => string;
  topic: string;
  investmentStudyMode?: "fixed" | "conditional";
  investmentStudyAngle?: InvestmentStudyEditorialAngle;
};

const STOCK_BLOG_SCHEDULE_DEFINITIONS: StockBlogSchedulerDefinition[] = [
  {
    scheduleId: "weekday-korea-daily-preview",
    contentType: "KOREA_DAILY_PREVIEW",
    label: "한국 증시 장전 브리핑",
    cadence: "평일",
    scheduledTimeKst: "06:50 KST 준비 시작 · 08:20 KST 고정 공개",
    scheduledTime: "06:50",
    publishTime: "08:20",
    maxAttempts: 6,
    dataFailureFallback: "investment-study",
    dataFailureFallbackAfterKst: "07:35",
    referenceMaxAttempts: 3,
    generationMaxAttempts: 2,
    weekdays: [1, 2, 3, 4, 5],
    objective: "06:50부터 자료를 수집하고 07:30 이후 누락된 선택 항목은 제외해 08:20에 당일 한국장 전망을 공개합니다.",
    primaryAudience: "한국 주식 투자자",
    recommendedRunnerMode: "hermes",
    topic: "전일 한국장 코멘트와 간밤 미국 지수·금리·원달러 환율이 오늘 코스피에 미칠 영향",
    title: (date) => `${date} 오늘 코스피 전망: 간밤 미국장·금리·환율 영향`,
  },
  {
    scheduleId: "weekday-korea-close-us-preview",
    contentType: "KOREA_MARKET_CLOSE_US_PREVIEW",
    label: "전일 미국장 리뷰·오늘 미국장 전망",
    cadence: "평일",
    scheduledTimeKst: "17:00 KST",
    scheduledTime: "17:00",
    weekdays: [1, 2, 3, 4, 5],
    objective: "전일 미국장을 짧게 복기하고 오늘 한국장의 연결 신호를 참고해 오늘 밤 미국장 전망을 정리합니다.",
    primaryAudience: "한국·미국 주식 병행 투자자",
    recommendedRunnerMode: "hermes",
    topic: "전일 나스닥·S&P500 흐름과 미국 국채금리·달러·주요 일정으로 보는 오늘 미국장 전망",
    title: (date) => `${date} 오늘 미국장 전망: 나스닥·미국 금리·주요 일정`,
  },
  {
    scheduleId: "saturday-weekly-market-review",
    contentType: "WEEKLY_MARKET_REVIEW",
    label: "토요일 한국·미국 주간 복기",
    cadence: "매주 토요일",
    scheduledTimeKst: "07:30 KST 준비 시작 · 09:00 KST 고정 공개",
    scheduledTime: "07:30",
    publishTime: "09:00",
    maxAttempts: 6,
    dataFailureFallback: "investment-study",
    dataFailureFallbackAfterKst: "08:20",
    referenceMaxAttempts: 3,
    generationMaxAttempts: 2,
    weekdays: [6],
    objective: "07:30부터 이번 주 한국·미국 증시 자료를 수집하고 09:00에 수급·주도 업종과 실제 변동 원인을 복기합니다.",
    primaryAudience: "토요일에 한 주의 시장 흐름을 복기하는 투자자",
    recommendedRunnerMode: "hermes",
    topic: "이번 주 코스피·나스닥 흐름과 외국인 수급·주도 업종·금리 변동 원인",
    title: (date) => `${date} 이번 주 증시 정리: 코스피·나스닥·주도 업종`,
  },
  {
    scheduleId: "weekday-fixed-investment-study-tuesday",
    contentType: "INVESTMENT_STUDY",
    label: "화요일 이번 주 일정·검색 질문",
    cadence: "매주 화요일",
    scheduledTimeKst: "10:00 KST 준비 시작 · 12:10 KST 고정 공개",
    scheduledTime: "10:00",
    publishTime: "12:10",
    weekdays: [2],
    objective: "이번 주 공식 경제 일정이 있으면 발표시간·예상치·시장 영향 질문에 답하고, 일정이 없으면 검색형 실전 질문을 발행합니다.",
    primaryAudience: "경제 일정과 투자 개념을 검색해 바로 확인하려는 투자자",
    recommendedRunnerMode: "hermes",
    topic: "오늘 코스피·미국장 핵심 이슈와 연결한 주식 투자 공부",
    title: (date) => `${date} 오늘 시장 이슈로 배우는 주식 투자 원리`,
    investmentStudyMode: "fixed",
    investmentStudyAngle: "upcoming_question",
  },
  {
    scheduleId: "weekday-fixed-investment-study-thursday",
    contentType: "INVESTMENT_STUDY",
    label: "목요일 발표 결과·실전 질문",
    cadence: "매주 목요일",
    scheduledTimeKst: "10:00 KST 준비 시작 · 12:10 KST 고정 공개",
    scheduledTime: "10:00",
    publishTime: "12:10",
    weekdays: [4],
    objective: "이번 주 경제지표·실적 발표 뒤 실제 시장 반응을 설명하고, 뚜렷한 결과가 없으면 검색형 실전 질문을 발행합니다.",
    primaryAudience: "발표 결과와 주가 반응의 이유를 검색하는 투자자",
    recommendedRunnerMode: "hermes",
    topic: "오늘 코스피·미국장 핵심 이슈와 연결한 주식 투자 공부",
    title: (date) => `${date} 오늘 시장 이슈로 배우는 주식 투자 원리`,
    investmentStudyMode: "fixed",
    investmentStudyAngle: "result_or_practical",
  },
  {
    scheduleId: "weekday-market-issue-investment-study",
    contentType: "INVESTMENT_STUDY",
    label: "코스피·미국장 이슈 조건부 투자 공부",
    cadence: "월·수·금 중 이슈가 확인된 날 · 주 1회 한도",
    scheduledTimeKst: "12:10 KST 조건부 확인",
    scheduledTime: "12:10",
    weekdays: [1, 3, 5],
    objective: "코스피·코스닥·나스닥 급변이나 물가·금리·반도체·실적 이슈가 확인될 때만 투자 원리 공부 글을 추가 발행합니다.",
    primaryAudience: "뉴스를 투자 원리까지 연결해 이해하려는 투자자",
    recommendedRunnerMode: "hermes",
    topic: "오늘 코스피·미국장 핵심 이슈로 배우는 투자 원리",
    title: (date) => `${date} 코스피·미국장 이슈로 배우는 투자 원리`,
    investmentStudyMode: "conditional",
    investmentStudyAngle: "issue_explainer",
  },
  {
    scheduleId: "sunday-next-week-market-preview",
    contentType: "NEXT_WEEK_MARKET_PREVIEW",
    label: "다음 주 주요 이슈·섹터 프리뷰",
    cadence: "매주 일요일",
    scheduledTimeKst: "19:00 KST",
    scheduledTime: "19:00",
    weekdays: [0],
    objective: "다음 주 핵심 이슈와 영향 섹터, 경제·실적 일정과 대응 조건을 준비합니다.",
    primaryAudience: "일요일 저녁 다음 주 투자 계획을 세우는 투자자",
    recommendedRunnerMode: "hermes",
    topic: "다음 주 한국·미국 증시 주요 이슈 3개와 영향 섹터·경제 일정·실적·금리 조건",
    title: (date) => `${date} 다음 주 증시 주요 이슈와 영향 섹터·일정`,
  },
  {
    scheduleId: "weekday-large-cap-disclosure-earnings",
    contentType: "LARGE_CAP_DISCLOSURE_EARNINGS",
    label: "대형주 공시·실적 조건부 체크",
    cadence: "평일 공식 발표가 있는 날",
    scheduledTimeKst: "18:30 KST 조건부 확인",
    scheduledTime: "18:30",
    weekdays: [1, 2, 3, 4, 5],
    objective: "OpenDART·SEC 공식 발표가 확인된 대형주가 있을 때만 공시·실적 분석을 발행합니다.",
    primaryAudience: "대형주 공식 발표와 핵심 숫자를 확인하는 투자자",
    recommendedRunnerMode: "hermes",
    topic: "오늘 공식 발표가 확인된 대형주 공시·실적 핵심 숫자와 시장 영향",
    title: (date) => `${date} 대형주 공시·실적 발표 핵심 숫자 분석`,
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
    largeCapEventsEnabled: parseBoolean(process.env.STOCK_BLOG_LARGE_CAP_EVENTS_ENABLED, false),
    weekdayInvestmentStudyEnabled: parseBoolean(process.env.STOCK_BLOG_WEEKDAY_INVESTMENT_STUDY_ENABLED, false),
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

function scheduleKey(definition: StockBlogSchedulerDefinition, marketDate: string) {
  return buildStockBlogLogicalScheduleKey(definition.scheduleId, marketDate);
}

function schedulerEventId(key: string) {
  return `event-stock-scheduler-${key}`;
}

function legacySchedulerEventIds(
  definition: StockBlogSchedulerDefinition,
  marketDate: string,
  timezone: string,
) {
  const [year, month, day] = marketDate.split("-").map(Number);
  const times = Array.from(new Set([
    definition.scheduledTime,
    ...(definition.scheduleId === "weekday-korea-daily-preview" ? ["07:20"] : []),
  ]));
  return times.flatMap((time) => {
    const { hour, minute } = parseTime(time);
    const scheduledAt = zonedDateTimeToUtc(year, month, day, hour, minute, timezone);
    const utcStamp = scheduledAt.toISOString().slice(0, 16).replace(/[-:T]/g, "");
    const localStamp = `${marketDate.replace(/-/g, "")}${pad(hour)}${pad(minute)}`;
    return [
      schedulerEventId(`${definition.scheduleId}-${utcStamp}`),
      schedulerEventId(`${definition.scheduleId}-${localStamp}`),
    ];
  });
}

function briefDateLabel(now: Date, timezone: string) {
  const parts = getZonedParts(now, timezone);
  return `${String(parts.year).slice(2)}/${pad(parts.month)}/${pad(parts.day)}`;
}

function buildPipelineInput(definition: StockBlogSchedulerDefinition, runnerMode: StockBlogSchedulerRunnerMode, now: Date, timezone: string) {
  const date = briefDateLabel(now, timezone);
  const parts = getZonedParts(now, timezone);
  const marketDate = `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
  const previousUsSession = definition.contentType === "KOREA_DAILY_PREVIEW"
    ? getNyseMarketSession(addIsoDays(marketDate, -1), {
      closedDates: process.env.STOCK_BLOG_US_CLOSED_DATES,
      openDates: process.env.STOCK_BLOG_US_OPEN_DATES,
    })
    : null;
  const followsUsHoliday = previousUsSession?.state === "closed" && !previousUsSession.reason.includes("주말");
  const sourceTitle = followsUsHoliday
    ? `${date} 오늘 코스피 전망: 미국장 휴장·금리·환율 영향`
    : definition.title(date);
  const topic = followsUsHoliday
    ? "직전 미국장은 휴장입니다. 존재하지 않는 미국장 등락을 만들지 말고, 직전 한국장 확정값과 미국 선물·국채금리·원달러 환율로 오늘 코스피 조건을 설명합니다."
    : definition.topic;
  return {
    topic,
    title: buildStockBlogEditorialTitle({
      template: definition.contentType,
      marketDate: date,
      sourceTitle,
    }),
    channel: "blog",
    runnerMode,
    contentType: definition.contentType,
  };
}

async function buildInvestmentStudyPipelineInput(
  definition: StockBlogSchedulerDefinition,
  runnerMode: StockBlogSchedulerRunnerMode,
  now: Date,
  timezone: string,
) {
  const date = briefDateLabel(now, timezone);
  const discoveryTitle = definition.investmentStudyAngle === "upcoming_question"
    ? `${date} 이번 주 미국 경제지표 발표시간과 나스닥 영향`
    : definition.investmentStudyAngle === "result_or_practical"
      ? `${date} 이번 주 경제지표·실적 발표 뒤 주가가 움직인 이유`
      : `${date} 오늘 코스피·미국장 이슈로 배우는 투자 원리`;
  const discoveryTopic = definition.investmentStudyAngle === "upcoming_question"
    ? "이번 주 CPI·PPI·FOMC·고용지표 공식 일정과 발표시간, 예상보다 높거나 낮을 때 나스닥·금리 영향"
    : definition.investmentStudyAngle === "result_or_practical"
      ? "이번 주 경제지표·실적 발표 실제값과 예상치 차이, 발표 뒤 코스피·나스닥·금리·수급 반응"
      : "오늘 코스피·코스닥·나스닥 급등락과 금리·환율·물가·반도체·실적 이슈의 투자 원리";
  const baseReferenceBundle = await collectStockBlogReferences({
    topic: discoveryTopic,
    title: discoveryTitle,
    channel: "blog",
    contentType: "INVESTMENT_STUDY",
    market: "GLOBAL",
    keywords: definition.investmentStudyAngle === "upcoming_question"
      ? ["CPI", "PPI", "FOMC", "발표시간"]
      : ["코스피", "나스닥", "금리", "실적"],
    maxResults: 6,
  });
  const resultScan = definition.investmentStudyAngle === "result_or_practical"
    ? await scanLargeCapDisclosureEvents({ now })
    : null;
  const filingResultItems = resultScan
    ? largeCapEventsToReferenceItems(resultScan.events.filter((event) => event.eventType === "earnings"))
      .map((item) => ({ ...item, contentType: "INVESTMENT_STUDY" as const }))
    : [];
  const verifiedReleaseItems: ReferenceItem[] = resultScan?.events.some((event) => (
    event.symbol === "NVDA" && event.eventType === "earnings" && event.filedAt === "2026-08-26"
  ))
    ? [{
      id: "official-nvidia-q2-fy2027-results",
      sourceType: "company",
      provider: "nvidia-newsroom",
      title: "NVIDIA Announces Financial Results for Second Quarter Fiscal 2027",
      url: "https://nvidianews.nvidia.com/news/nvidia-announces-financial-results-for-second-quarter-fiscal-2027",
      originalUrl: "https://nvidianews.nvidia.com/news/nvidia-announces-financial-results-for-second-quarter-fiscal-2027",
      publisher: "NVIDIA Newsroom",
      sourceName: "NVIDIA Newsroom",
      publishedAt: "2026-08-26",
      collectedAt: new Date().toISOString(),
      summary: "NVIDIA FY2027 2분기 매출은 962억달러로 전년 동기 대비 106%, 전 분기 대비 18% 증가했습니다. 데이터센터 매출은 890억달러로 전년 동기 대비 117% 증가했고, GAAP·비GAAP 매출총이익률은 모두 75.0%, GAAP EPS는 2.46달러, 비GAAP EPS는 2.22달러였습니다. FY2027 3분기 매출 가이던스는 1,080억달러±2%이며 중국 데이터센터 컴퓨트 매출은 가정하지 않았습니다.",
      keywords: ["NVIDIA", "NVDA", "엔비디아 실적", "데이터센터", "가이던스"],
      relevanceScore: 1,
      usageNote: "공식 발표 원문의 확정 실적과 다음 분기 가이던스를 우선 사용",
      copyrightPolicy: "공식 자료의 사실과 수치만 자체 문장으로 요약하고 원문 링크를 표시",
      contentType: "INVESTMENT_STUDY",
      market: "US",
      symbols: ["NVDA"],
      reliability: "official",
      metrics: [
        { key: "nvidia.fy2027.q2.revenue", label: "매출", value: 96.2, unit: "십억달러", asOf: "2026-08-26", sourceName: "NVIDIA Newsroom", sourceUrl: "https://nvidianews.nvidia.com/news/nvidia-announces-financial-results-for-second-quarter-fiscal-2027" },
        { key: "nvidia.fy2027.q2.dataCenterRevenue", label: "데이터센터 매출", value: 89, unit: "십억달러", asOf: "2026-08-26", sourceName: "NVIDIA Newsroom", sourceUrl: "https://nvidianews.nvidia.com/news/nvidia-announces-financial-results-for-second-quarter-fiscal-2027" },
        { key: "nvidia.fy2027.q2.nonGaapEps", label: "조정 EPS", value: 2.22, unit: "달러", asOf: "2026-08-26", sourceName: "NVIDIA Newsroom", sourceUrl: "https://nvidianews.nvidia.com/news/nvidia-announces-financial-results-for-second-quarter-fiscal-2027" },
        { key: "nvidia.fy2027.q3.revenueGuidance", label: "다음 분기 매출 가이던스", value: 108, unit: "십억달러", asOf: "2026-08-26", sourceName: "NVIDIA Newsroom", sourceUrl: "https://nvidianews.nvidia.com/news/nvidia-announces-financial-results-for-second-quarter-fiscal-2027" },
      ],
    }]
    : [];
  const verifiedReactionItems: ReferenceItem[] = resultScan?.events.some((event) => (
    event.symbol === "NVDA" && event.eventType === "earnings" && event.filedAt === "2026-08-26"
  ))
    ? [
      {
        id: "verified-ap-nvidia-q2-fy2027-reaction",
        sourceType: "news",
        provider: "verified-web",
        title: "Strong AI chip demand fuels Nvidia's Q2 results well beyond Wall Street's expectations",
        url: "https://apnews.com/article/dc8d556e709b50915cca9217a60b1991",
        originalUrl: "https://apnews.com/article/dc8d556e709b50915cca9217a60b1991",
        publisher: "AP News",
        sourceName: "AP News",
        publishedAt: "2026-08-26T20:40:45Z",
        collectedAt: new Date().toISOString(),
        summary: "AP는 FactSet 기준 조정 EPS 예상 2.09달러와 매출 예상 922.7억달러를 실제 조정 EPS 2.22달러·매출 962.2억달러와 비교했고, 실적 발표 뒤 엔비디아가 시간외 거래에서 4.1% 상승했다고 보도했습니다.",
        keywords: ["엔비디아 실적", "시간외 4.1%", "시장 예상치", "데이터센터"],
        relevanceScore: 1,
        usageNote: "시간외 반응과 시장 예상치 비교는 이 기사에 확인된 수치만 사용",
        copyrightPolicy: "기사의 사실과 수치만 자체 문장으로 요약하고 원문 링크를 표시",
        contentType: "INVESTMENT_STUDY",
        market: "US",
        symbols: ["NVDA"],
        reliability: "major_media",
        metrics: [
          { key: "nvidia.fy2027.q2.revenueEstimate", label: "FactSet 매출 예상", value: 92.27, unit: "십억달러", asOf: "2026-08-26", sourceName: "AP News · FactSet", sourceUrl: "https://apnews.com/article/dc8d556e709b50915cca9217a60b1991" },
          { key: "nvidia.fy2027.q2.nonGaapEpsEstimate", label: "FactSet 조정 EPS 예상", value: 2.09, unit: "달러", asOf: "2026-08-26", sourceName: "AP News · FactSet", sourceUrl: "https://apnews.com/article/dc8d556e709b50915cca9217a60b1991" },
          { key: "nvidia.fy2027.q2.afterHoursChangePct", label: "시간외 주가 반응", value: 4.1, unit: "%", asOf: "2026-08-26 실적 발표 뒤", sourceName: "AP News", sourceUrl: "https://apnews.com/article/dc8d556e709b50915cca9217a60b1991" },
        ],
      },
      {
        id: "verified-newdaily-nvidia-korea-reaction-20260827",
        sourceType: "news",
        provider: "verified-web",
        title: "엔비디아가 잠재운 'AI 고점론' … 코스피 7000선 재돌파 코앞",
        url: "https://biz.newdaily.co.kr/site/data/html/2026/08/27/2026082700041.html",
        originalUrl: "https://biz.newdaily.co.kr/site/data/html/2026/08/27/2026082700041.html",
        publisher: "뉴데일리경제",
        sourceName: "뉴데일리경제",
        publishedAt: "2026-08-27T09:27:00+09:00",
        collectedAt: new Date().toISOString(),
        summary: "27일 장중 엔비디아 실적과 시간외 4%대 강세 뒤 삼성전자와 SK하이닉스가 동반 상승했고, 반도체 업종과 코스피가 강세를 보였다고 보도했습니다. 국내 반도체 반응은 당일 장중 시각 기준으로만 사용합니다.",
        keywords: ["엔비디아 실적", "삼성전자", "SK하이닉스", "코스피", "반도체"],
        relevanceScore: 1,
        usageNote: "국내 반도체주와 코스피 반응은 기사 입력 시각을 함께 밝혀 사용",
        copyrightPolicy: "기사의 사실과 수치만 자체 문장으로 요약하고 원문 링크를 표시",
        contentType: "INVESTMENT_STUDY",
        market: "KR",
        symbols: ["NVDA", "005930", "000660"],
        reliability: "major_media",
      },
      {
        id: "verified-etoday-nvidia-hbm-link-20260826",
        sourceType: "news",
        provider: "verified-web",
        title: "엔비디아 실적 앞두고 삼성·SK 촉각…‘메모리 호황’ 이어질까",
        url: "https://m.etoday.co.kr/news/view/2618457",
        originalUrl: "https://m.etoday.co.kr/news/view/2618457",
        publisher: "이투데이",
        sourceName: "이투데이",
        publishedAt: "2026-08-26T16:16:00+09:00",
        collectedAt: new Date().toISOString(),
        summary: "엔비디아 데이터센터와 차세대 AI 가속기 수요가 HBM4 수요 전망을 거쳐 삼성전자·SK하이닉스 공급 기대와 연결되는 경로를 설명한 사전 기사입니다. 실제 실적 뒤 주가 반응과 전망을 구분해 사용합니다.",
        keywords: ["엔비디아", "HBM4", "삼성전자", "SK하이닉스", "메모리"],
        relevanceScore: 0.98,
        usageNote: "데이터센터 수요에서 HBM 공급사로 이어지는 산업 연결 경로에 한해 사용",
        copyrightPolicy: "기사의 사실과 산업 연결 설명만 자체 문장으로 요약하고 원문 링크를 표시",
        contentType: "INVESTMENT_STUDY",
        market: "GLOBAL",
        symbols: ["NVDA", "005930", "000660"],
        reliability: "major_media",
      },
    ]
    : [];
  const officialResultItems = [...verifiedReleaseItems, ...filingResultItems];
  const verifiedResultItems = [...officialResultItems, ...verifiedReactionItems];
  const referenceBundle: ReferenceBundle = verifiedResultItems.length > 0
    ? {
      ...baseReferenceBundle,
      items: [
        ...verifiedResultItems,
        ...baseReferenceBundle.items.filter((item) => !verifiedResultItems.some((verified) => verified.url === item.url)),
      ],
      keyThemes: Array.from(new Set([
        ...verifiedResultItems.flatMap((item) => item.keywords ?? []),
        ...baseReferenceBundle.keyThemes,
      ])),
      sourcePolicy: `${baseReferenceBundle.sourcePolicy} 실적 수치는 SEC·OpenDART 공식 제출을 우선 확인합니다.`,
    }
    : baseReferenceBundle;
  const selection = selectInvestmentStudyTopic({
    now,
    referenceBundle,
    angle: definition.investmentStudyAngle,
  });
  const refinedReferenceBundle = definition.investmentStudyMode === "fixed"
    ? await collectStockBlogReferences({
      topic: selection.topic,
      title: selection.title,
      channel: "blog",
      contentType: "INVESTMENT_STUDY",
      market: "GLOBAL",
      keywords: selection.keywords,
      maxResults: 6,
      prioritizeInputQueries: true,
    })
    : referenceBundle;
  const selectionText = `${selection.title}\n${selection.topic}\n${selection.keywords.join(" ")}`.toLowerCase();
  const selectedResultItems = definition.investmentStudyAngle === "result_or_practical" && selection.score >= 5
    ? verifiedResultItems
    : verifiedResultItems.filter((item) => (
      (item.keywords ?? []).some((keyword) => selectionText.includes(keyword.toLowerCase()))
      || (item.symbols ?? []).some((symbol) => selectionText.includes(symbol.toLowerCase()))
    ));
  const selectedReferenceBundle: ReferenceBundle = selectedResultItems.length > 0
    ? {
      ...refinedReferenceBundle,
      items: [
        ...selectedResultItems,
        ...refinedReferenceBundle.items.filter((item) => !selectedResultItems.some((selected) => selected.url === item.url)),
      ],
      keyThemes: Array.from(new Set([
        ...selectedResultItems.flatMap((item) => item.keywords ?? []),
        ...refinedReferenceBundle.keyThemes,
      ])),
      sourcePolicy: `${refinedReferenceBundle.sourcePolicy} 실적 수치는 SEC·OpenDART 공식 제출을 우선 확인합니다.`,
    }
    : refinedReferenceBundle;
  return {
    selection,
    input: {
      topic: selection.topic,
      title: buildStockBlogEditorialTitle({
        template: definition.contentType,
        marketDate: date,
        sourceTitle: selection.title,
      }),
      channel: "blog" as const,
      runnerMode,
      contentType: definition.contentType,
      referenceBundle: selectedReferenceBundle,
    },
  };
}

async function findNextOpenMarketDate(session: StockMarketSession) {
  for (let offset = 1; offset <= 10; offset += 1) {
    const candidate = addIsoDays(session.marketDate, offset);
    const candidateSession = session.market === "KRX"
      ? getKrxMarketSession(candidate, {
        closedDates: process.env.STOCK_BLOG_KRX_CLOSED_DATES,
        openDates: process.env.STOCK_BLOG_KRX_OPEN_DATES,
      })
      : getNyseMarketSession(candidate, {
        closedDates: process.env.STOCK_BLOG_US_CLOSED_DATES,
        openDates: process.env.STOCK_BLOG_US_OPEN_DATES,
      });
    if (candidateSession.state === "open") return candidate;
  }
  return null;
}

async function buildHolidaySearchStudyPipelineInput(
  session: StockMarketSession,
  runnerMode: StockBlogSchedulerRunnerMode,
  now: Date,
  timezone: string,
) {
  const nextOpenDate = await findNextOpenMarketDate(session);
  const plan = buildHolidaySearchStudyPlan({ session, nextOpenDate });
  if (!plan) throw new Error("휴장 검색 유입형 투자공부 주제를 만들 수 없습니다.");

  const referenceBundle = await collectStockBlogReferences({
    topic: plan.topic,
    title: plan.sourceTitle,
    channel: "blog",
    contentType: "INVESTMENT_STUDY",
    market: plan.market,
    keywords: plan.keywords,
    maxResults: 6,
  });
  return {
    nextOpenDate,
    input: {
      topic: plan.topic,
      title: buildStockBlogEditorialTitle({
        template: "INVESTMENT_STUDY",
        marketDate: briefDateLabel(now, timezone),
        sourceTitle: plan.sourceTitle,
      }),
      channel: "blog" as const,
      runnerMode,
      contentType: "INVESTMENT_STUDY" as const,
      referenceBundle,
    },
  };
}

async function buildMarketDataFallbackStudyPipelineInput(
  definition: StockBlogSchedulerDefinition,
  runnerMode: StockBlogSchedulerRunnerMode,
  marketDate: string,
  now: Date,
  timezone: string,
) {
  const plan = buildMarketDataFallbackStudyPlan({
    marketDate,
    sourceContentType: definition.contentType,
  });
  const referenceBundle = await collectStockBlogReferences({
    topic: plan.topic,
    title: plan.sourceTitle,
    channel: "blog",
    contentType: "INVESTMENT_STUDY",
    market: "GLOBAL",
    keywords: plan.keywords,
    maxResults: 6,
  });
  return {
    input: {
      topic: plan.topic,
      title: buildStockBlogEditorialTitle({
        template: "INVESTMENT_STUDY",
        marketDate: briefDateLabel(now, timezone),
        sourceTitle: plan.sourceTitle,
      }),
      channel: "blog" as const,
      runnerMode,
      contentType: "INVESTMENT_STUDY" as const,
      referenceBundle,
    },
  };
}

async function buildLargeCapPipelineInput(
  definition: StockBlogSchedulerDefinition,
  runnerMode: StockBlogSchedulerRunnerMode,
  now: Date,
  timezone: string,
  scan: LargeCapDisclosureScanResult,
) {
  const date = briefDateLabel(now, timezone);
  const companies = scan.events.map((event) => event.symbol ? `${event.company}(${event.symbol})` : event.company);
  const topic = `${companies.join("·")} 공식 공시·실적 핵심 숫자와 주가·업종 영향`;
  const sourceTitle = `${companies.slice(0, 2).join("·")} 공시·실적 발표 핵심 숫자`;
  const title = buildStockBlogEditorialTitle({ template: definition.contentType, marketDate: date, sourceTitle });
  const baseBundle = await collectStockBlogReferences({
    topic,
    title,
    channel: "blog",
    contentType: "LARGE_CAP_DISCLOSURE_EARNINGS",
    market: "GLOBAL",
    keywords: companies,
    maxResults: 6,
  });
  const officialItems = largeCapEventsToReferenceItems(scan.events);
  const referenceBundle: ReferenceBundle = {
    ...baseBundle,
    contentType: "LARGE_CAP_DISCLOSURE_EARNINGS",
    market: "GLOBAL",
    items: [...officialItems, ...baseBundle.items.filter((item) => !officialItems.some((official) => official.url === item.url))],
    keyThemes: Array.from(new Set([...companies, ...baseBundle.keyThemes])),
    summary: `${scan.events.length}건의 대형주 공식 발표를 확인했습니다. ${baseBundle.summary ?? ""}`.trim(),
  };
  return { topic, title, channel: "blog" as const, runnerMode, contentType: definition.contentType, referenceBundle };
}

function usageSnapshot(usage: Awaited<ReturnType<typeof getHermesUsageSummary>>) {
  return { used: usage.used, remaining: usage.remaining, limit: usage.limit };
}

async function persistSchedulerEvent(input: {
  key: string;
  contentType: StockBlogContentType;
  scheduledFor: string;
  status: StockBlogSchedulerRunStatus;
  summary: string;
  payload: Prisma.InputJsonObject;
  expectedRetryV2: StockBlogRetryV2State;
}) {
  const id = schedulerEventId(input.key);
  for (let casAttempt = 0; casAttempt < 8; casAttempt += 1) {
    const previous = await prisma.eventLog.findUnique({ where: { id } });
    const previousPayload = previous ? eventPayload(previous.payload) : {};
    if (previousPayload.retryV2 !== undefined) {
      const currentRetry = parseStockBlogRetryV2({ payload: { retryV2: previousPayload.retryV2 } });
      if (!currentRetry.ok || JSON.stringify(currentRetry.state) !== JSON.stringify(input.expectedRetryV2)) {
        // This caller finished against an older phase revision. Returning the
        // newer event prevents stale succeeded/failed/skipped status from
        // hiding a lease that another worker already owns.
        return previous;
      }
    }
    // A status/summary write must never replace a phase lease or checkpoint that a
    // concurrent worker has already claimed. The latest persisted retry fields win.
    const retryPersistence = {
      retryV2: retryStateJson(input.expectedRetryV2),
      ...(previousPayload.retryCheckpoint !== undefined ? { retryCheckpoint: previousPayload.retryCheckpoint } : {}),
      ...(previousPayload.referenceAttempt !== undefined ? { referenceAttempt: previousPayload.referenceAttempt } : {}),
      ...(previousPayload.generationAttempt !== undefined ? { generationAttempt: previousPayload.generationAttempt } : {}),
      ...(previousPayload.draftAssemblyAttempt !== undefined ? { draftAssemblyAttempt: previousPayload.draftAssemblyAttempt } : {}),
    };
    const payload: Prisma.InputJsonObject = {
      scheduleKey: input.key,
      contentType: input.contentType,
      scheduledFor: input.scheduledFor,
      status: input.status,
      ...input.payload,
      ...retryPersistence,
    };
    const timestamp = new Date(Math.max(Date.now(), (previous?.timestamp.getTime() ?? 0) + 1));
    let event;
    if (!previous) {
      try {
        event = await prisma.eventLog.create({
          data: { id, type: EVENT_TYPE, timestamp, payload, summary: input.summary },
        });
      } catch (error) {
        if (isPrismaUniqueConflict(error)) continue;
        throw error;
      }
    } else {
      const updated = await prisma.eventLog.updateMany({
        where: { id, timestamp: previous.timestamp },
        data: { timestamp, payload, summary: input.summary },
      });
      if (updated.count !== 1) continue;
      event = await prisma.eventLog.findUnique({ where: { id } });
      if (!event) throw new Error("STOCK_SCHEDULER_EVENT_MISSING_AFTER_UPDATE");
    }
    if (input.status === "failed" || input.status === "partial_failed") {
      await recordFailureFromPersistedEvent(event).catch((error: unknown) => {
        console.error("Operational learning failed after scheduler event persistence", error);
      });
    }
    return event;
  }
  throw new Error("STOCK_SCHEDULER_EVENT_UPDATE_CONFLICT");
}

function eventPayload(value: Prisma.JsonValue): Record<string, Prisma.JsonValue> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, Prisma.JsonValue>
    : {};
}

type StockBlogRetryCheckpoint = {
  pipelineInput?: ContentPipelineInput;
  pipelineId?: string;
  approvalId?: string;
  naverDraftJobId?: string;
};

type SchedulerPhaseClaim = {
  action: "claim" | "completed" | "blocked";
  state: StockBlogRetryV2State;
  checkpoint: StockBlogRetryCheckpoint;
  token?: string;
  attempt?: number;
  reason?: string;
};

function retryCheckpointFromPayload(payload: Record<string, Prisma.JsonValue>): StockBlogRetryCheckpoint {
  const value = payload.retryCheckpoint;
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const record = value as Record<string, unknown>;
  return {
    pipelineInput: record.pipelineInput && typeof record.pipelineInput === "object" && !Array.isArray(record.pipelineInput)
      ? record.pipelineInput as ContentPipelineInput
      : undefined,
    pipelineId: typeof record.pipelineId === "string" ? record.pipelineId : undefined,
    approvalId: typeof record.approvalId === "string" ? record.approvalId : undefined,
    naverDraftJobId: typeof record.naverDraftJobId === "string" ? record.naverDraftJobId : undefined,
  };
}

function retryCheckpointJson(checkpoint: StockBlogRetryCheckpoint): Prisma.InputJsonObject {
  return JSON.parse(JSON.stringify(checkpoint)) as Prisma.InputJsonObject;
}

function retryStateJson(state: StockBlogRetryV2State): Prisma.InputJsonObject {
  return JSON.parse(JSON.stringify(state)) as Prisma.InputJsonObject;
}

function isPrismaUniqueConflict(error: unknown) {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "P2002");
}

async function claimSchedulerPhase(input: {
  key: string;
  contentType: StockBlogContentType;
  scheduledFor: string;
  phase: StockBlogRetryPhase;
  now: Date;
  seedState?: StockBlogRetryV2State;
  seedCheckpoint?: StockBlogRetryCheckpoint;
  forceReferenceRefresh?: boolean;
  maxAttempts?: number;
}): Promise<SchedulerPhaseClaim> {
  const id = schedulerEventId(input.key);
  for (let casAttempt = 0; casAttempt < 5; casAttempt += 1) {
    const current = await prisma.eventLog.findUnique({ where: { id } });
    const payload = current ? eventPayload(current.payload) : {};
    const parsed = current
      ? parseStockBlogRetryV2({ payload, eventTimestamp: current.timestamp })
      : { ok: true as const, state: input.seedState ?? createEmptyStockBlogRetryV2State(), migratedFromLegacy: Boolean(input.seedState) };
    if (!parsed.ok) {
      return {
        action: "blocked",
        state: createEmptyStockBlogRetryV2State(),
        checkpoint: retryCheckpointFromPayload(payload),
        reason: parsed.reason,
      };
    }
    let checkpoint = current ? retryCheckpointFromPayload(payload) : input.seedCheckpoint ?? {};
    const token = randomUUID();
    const claimNow = new Date(Math.max(input.now.getTime(), (current?.timestamp.getTime() ?? 0) + 1));
    let claimState = parsed.state;
    if (input.forceReferenceRefresh) {
      if (claimState.lease && Date.parse(claimState.lease.expiresAt) > claimNow.getTime()) {
        return {
          action: "blocked",
          state: claimState,
          checkpoint,
          reason: `${claimState.lease.phase} 단계가 다른 실행에서 처리 중입니다.`,
        };
      }
      if (claimState.lease) claimState = { ...claimState, lease: null };
      const refreshState = requestStockBlogRetryV2ReferenceRefresh(claimState);
      if (!refreshState) {
        return {
          action: "blocked",
          state: claimState,
          checkpoint,
          reason: "참고자료 갱신 상태로 안전하게 전환할 수 없습니다.",
        };
      }
      claimState = refreshState;
      checkpoint = {};
    }
    const decision = evaluateStockBlogRetryV2Claim({
      state: claimState,
      phase: input.phase,
      now: claimNow,
      token,
      maxAttempts: input.maxAttempts,
    });
    if (decision.action !== "claim") {
      return {
        action: decision.action,
        state: decision.state,
        checkpoint,
        reason: decision.action === "blocked" ? decision.reason : undefined,
      };
    }
    const nextPayload: Prisma.InputJsonObject = {
      ...payload,
      scheduleKey: input.key,
      contentType: input.contentType,
      scheduledFor: input.scheduledFor,
      status: "running",
      phase: input.phase,
      attempt: Math.max(...Object.values(decision.state.attempts)),
      referenceAttempt: decision.state.attempts.reference_preflight,
      generationAttempt: decision.state.attempts.content_generation,
      draftAssemblyAttempt: decision.state.attempts.draft_assembly,
      retryV2: retryStateJson(decision.state),
      retryCheckpoint: retryCheckpointJson(checkpoint),
    };
    if (!current) {
      try {
        await prisma.eventLog.create({
          data: {
            id,
            type: EVENT_TYPE,
            timestamp: claimNow,
            summary: `${input.contentType} ${input.phase} ${decision.lease.attempt}회차 시작`,
            payload: nextPayload,
          },
        });
        return { action: "claim", state: decision.state, checkpoint, token, attempt: decision.lease.attempt };
      } catch (error) {
        if (isPrismaUniqueConflict(error)) continue;
        throw error;
      }
    }
    const updated = await prisma.eventLog.updateMany({
      where: { id, timestamp: current.timestamp },
      data: {
        timestamp: claimNow,
        summary: `${input.contentType} ${input.phase} ${decision.lease.attempt}회차 시작`,
        payload: nextPayload,
      },
    });
    if (updated.count === 1) {
      return { action: "claim", state: decision.state, checkpoint, token, attempt: decision.lease.attempt };
    }
  }
  return {
    action: "blocked",
    state: input.seedState ?? createEmptyStockBlogRetryV2State(),
    checkpoint: input.seedCheckpoint ?? {},
    reason: "동시에 실행된 다른 스케줄러가 단계 실행권을 획득했습니다.",
  };
}

async function settleSchedulerPhase(input: {
  key: string;
  token: string;
  succeeded: boolean;
  consumeAttempt?: boolean;
  reopenContentGeneration?: boolean;
  requestReferenceRefresh?: boolean;
  checkpoint: StockBlogRetryCheckpoint;
}) {
  const id = schedulerEventId(input.key);
  for (let casAttempt = 0; casAttempt < 8; casAttempt += 1) {
    const current = await prisma.eventLog.findUnique({ where: { id } });
    if (!current) throw new Error("STOCK_RETRY_V2_EVENT_MISSING");
    const payload = eventPayload(current.payload);
    const parsed = parseStockBlogRetryV2({ payload, eventTimestamp: current.timestamp });
    if (!parsed.ok) throw new Error(`STOCK_RETRY_V2_STATE_INVALID: ${parsed.reason}`);
    const settledClaim = settleStockBlogRetryV2Claim({
      state: parsed.state,
      token: input.token,
      succeeded: input.succeeded,
      consumeAttempt: input.consumeAttempt,
    });
    if (!settledClaim) throw new Error("STOCK_RETRY_V2_LEASE_LOST");
    let settled: StockBlogRetryV2State | null = settledClaim;
    if (input.reopenContentGeneration) settled = reopenStockBlogRetryV2ContentGeneration(settled);
    if (settled && input.requestReferenceRefresh) settled = requestStockBlogRetryV2ReferenceRefresh(settled);
    if (!settled) throw new Error("STOCK_RETRY_V2_RECOVERY_TRANSITION_INVALID");
    const timestamp = new Date(Math.max(Date.now(), current.timestamp.getTime() + 1));
    const updated = await prisma.eventLog.updateMany({
      where: { id, timestamp: current.timestamp },
      data: {
        timestamp,
        payload: {
          ...payload,
          retryV2: retryStateJson(settled),
          retryCheckpoint: retryCheckpointJson(input.checkpoint),
          referenceAttempt: settled.attempts.reference_preflight,
          generationAttempt: settled.attempts.content_generation,
          draftAssemblyAttempt: settled.attempts.draft_assembly,
        },
      },
    });
    if (updated.count === 1) return settled;
  }
  throw new Error("STOCK_RETRY_V2_LEASE_UPDATE_CONFLICT");
}

async function resolveScheduleMarketDecision(
  contentType: StockBlogContentType,
  marketDate: string,
): Promise<StockBlogMarketSessionDecision> {
  const dependency = getStockBlogMarketDependency(contentType);
  if (!dependency) return evaluateStockBlogMarketSession({ contentType });
  const session = dependency === "KRX"
    ? getKrxMarketSession(marketDate, {
      closedDates: process.env.STOCK_BLOG_KRX_CLOSED_DATES,
      openDates: process.env.STOCK_BLOG_KRX_OPEN_DATES,
    })
    : getNyseMarketSession(marketDate, {
      closedDates: process.env.STOCK_BLOG_US_CLOSED_DATES,
      openDates: process.env.STOCK_BLOG_US_OPEN_DATES,
    });
  return evaluateStockBlogMarketSession({ contentType, session });
}

async function clearRecoverablePipelineCircuitBreaker(scheduleKey: string) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.eventLog.findUnique({
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
    const unresolvedPublish = await tx.naverDraftJob.findFirst({
      where: {
        allowPublish: true,
        OR: [
          { status: "publishing" },
          { status: "publish_failed", updatedAt: { gte: existing.timestamp } },
        ],
      },
      select: { id: true },
    });
    if (unresolvedPublish) return false;

    const updated = await tx.eventLog.updateMany({
      where: {
        id: PUBLISH_CIRCUIT_BREAKER_EVENT_ID,
        timestamp: existing.timestamp,
        summary: existing.summary,
      },
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
    return updated.count === 1;
  }, { isolationLevel: "Serializable" });
}

function startOfSchedulerWeek(now: Date, timezone: string) {
  const parts = getZonedParts(now, timezone);
  const daysFromMonday = parts.weekday === 0 ? -6 : 1 - parts.weekday;
  const monday = addDays(parts, daysFromMonday, timezone);
  return zonedDateTimeToUtc(monday.year, monday.month, monday.day, 0, 0, timezone);
}

async function hasConditionalInvestmentStudyRunThisWeek(
  now: Date,
  timezone: string,
  currentScheduleKey: string,
) {
  const events = await prisma.eventLog.findMany({
    where: {
      type: EVENT_TYPE,
      timestamp: { gte: startOfSchedulerWeek(now, timezone) },
    },
    orderBy: { timestamp: "desc" },
    take: 50,
    select: { payload: true },
  });
  return events.some((event) => {
    const payload = eventPayload(event.payload);
    const scheduleKeyValue = typeof payload.scheduleKey === "string" ? payload.scheduleKey : "";
    const status = typeof payload.status === "string" ? payload.status : "";
    return scheduleKeyValue !== currentScheduleKey
      && scheduleKeyValue.startsWith("weekday-market-issue-investment-study-")
      && ["running", "succeeded", "partial_failed"].includes(status);
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
    largeCapEventsEnabled: config.largeCapEventsEnabled,
    weekdayInvestmentStudyEnabled: config.weekdayInvestmentStudyEnabled,
    now: now.toISOString(),
    plan,
    nextRun: plan[0] ?? null,
    recentRuns: recentRuns.map((run) => ({ id: run.id, timestamp: run.timestamp.toISOString(), summary: run.summary, payload: run.payload })),
  };
}

async function runOneSchedule(
  definition: StockBlogSchedulerDefinition,
  now: Date,
  config: StockBlogSchedulerConfig,
  options: { scheduledAt?: Date; manualRecovery?: boolean } = {},
): Promise<StockBlogSchedulerRunResult> {
  const contentType = definition.contentType;
  const scheduledAt = options.scheduledAt
    ?? getScheduledAtForParts(definition, getZonedParts(now, config.timezone), config.timezone);
  const scheduledFor = scheduledAt.toISOString();
  const scheduledParts = getZonedParts(scheduledAt, config.timezone);
  const marketDate = `${scheduledParts.year}-${pad(scheduledParts.month)}-${pad(scheduledParts.day)}`;
  const key = scheduleKey(definition, marketDate);
  const id = schedulerEventId(key);
  const standardPublishTime = definition.publishTime ?? definition.scheduledTime;
  const currentParts = getZonedParts(now, config.timezone);
  const currentMarketDate = `${currentParts.year}-${pad(currentParts.month)}-${pad(currentParts.day)}`;
  const { hour: publishHour, minute: publishMinute } = parseTime(standardPublishTime);
  const originalPublishAt = zonedDateTimeToUtc(
    scheduledParts.year,
    scheduledParts.month,
    scheduledParts.day,
    publishHour,
    publishMinute,
    config.timezone,
  );
  const publishTime = resolveStockBlogRecoveryPublishTime({
    standardPublishTime,
    manualRecovery: options.manualRecovery === true,
    marketDate,
    currentMarketDate,
    currentTime: `${pad(currentParts.hour)}:${pad(currentParts.minute)}`,
    originalPublishAtMs: originalPublishAt.getTime(),
    nowMs: now.getTime(),
    lateTtlMinutes: getNaverDraftLateTtlMinutes(),
  });
  let publishKey = buildStockBlogLogicalPublishKey(definition.scheduleId, marketDate);
  const publishKeyAliases = buildStockBlogLegacyPublishKeyAliases({
    contentType,
    marketDate,
    publishTime,
    legacyTimes: definition.scheduleId === "weekday-korea-daily-preview" ? ["06:50", "07:20"] : [],
  });

  if (config.autoPublish) {
    await clearRecoverablePipelineCircuitBreaker(key);
    if (config.firstAutoPublishAt && now.getTime() < Date.parse(config.firstAutoPublishAt)) {
      return { scheduleId: definition.scheduleId, contentType, scheduleKey: key, scheduledFor, status: "not_due", reason: "첫 자동 발행 예약 시각 이전" };
    }
  }

  const logicalExisting = await prisma.eventLog.findUnique({ where: { id } });
  const legacyExisting = logicalExisting
    ? null
    : await prisma.eventLog.findFirst({
      where: { id: { in: legacySchedulerEventIds(definition, marketDate, config.timezone) } },
      orderBy: { timestamp: "desc" },
    });
  const existing = logicalExisting ?? legacyExisting;
  const previousPayload = existing ? eventPayload(existing.payload) : {};
  const previousReason = typeof previousPayload.reason === "string" ? previousPayload.reason : "";
  const parsedRetry = parseStockBlogRetryV2({
    payload: previousPayload,
    eventTimestamp: existing?.timestamp,
  });
  if (!parsedRetry.ok) {
    return {
      scheduleId: definition.scheduleId,
      contentType,
      scheduleKey: key,
      scheduledFor,
      status: "already_ran",
      reason: parsedRetry.reason,
    };
  }
  let retryV2 = parsedRetry.state;
  const writeSchedulerEvent = (eventInput: Omit<Parameters<typeof persistSchedulerEvent>[0], "expectedRetryV2">) => persistSchedulerEvent({
    ...eventInput,
    expectedRetryV2: retryV2,
  });
  const legacyOperationalRunKey = typeof previousPayload.scheduleKey === "string"
    ? previousPayload.scheduleKey
    : legacyExisting
      ? legacyExisting.id.replace(/^event-stock-scheduler-/, "")
      : undefined;
  const legacyOperationalAttempt = typeof previousPayload.attempt === "number"
    && Number.isInteger(previousPayload.attempt)
    && previousPayload.attempt > 0
    ? previousPayload.attempt
    : undefined;
  let recoveredLegacyPipeline: ContentPipelineRun | null = null;
  if (!logicalExisting
    && parsedRetry.migratedFromLegacy
    && previousPayload.status === "running"
    && legacyOperationalRunKey
    && legacyOperationalAttempt) {
    recoveredLegacyPipeline = await findContentPipelineByOperationalAttempt(legacyOperationalRunKey, legacyOperationalAttempt);
    if (recoveredLegacyPipeline) {
      retryV2 = createEmptyStockBlogRetryV2State();
      retryV2.attempts.reference_preflight = 1;
      retryV2.completed.reference_preflight = true;
    }
  }
  let retryCheckpoint: StockBlogRetryCheckpoint = {
    ...retryCheckpointFromPayload(previousPayload),
    pipelineId: retryCheckpointFromPayload(previousPayload).pipelineId
      ?? (typeof previousPayload.pipelineId === "string" ? previousPayload.pipelineId : undefined),
    approvalId: retryCheckpointFromPayload(previousPayload).approvalId
      ?? (typeof previousPayload.approvalId === "string" ? previousPayload.approvalId : undefined),
    naverDraftJobId: retryCheckpointFromPayload(previousPayload).naverDraftJobId
      ?? (typeof previousPayload.naverDraftJobId === "string" ? previousPayload.naverDraftJobId : undefined),
  };
  if (recoveredLegacyPipeline) {
    retryCheckpoint = {
      ...retryCheckpoint,
      pipelineInput: {
        topic: recoveredLegacyPipeline.topic,
        title: recoveredLegacyPipeline.title,
        channel: recoveredLegacyPipeline.channel,
        runnerMode: recoveredLegacyPipeline.runnerMode,
        contentType: recoveredLegacyPipeline.referenceBundle?.contentType,
        referenceBundle: recoveredLegacyPipeline.referenceBundle,
      },
    };
  }
  const previousReferenceAttempt = retryV2.attempts.reference_preflight;
  const previousGenerationAttempt = retryV2.attempts.content_generation;
  if (!recoveredLegacyPipeline && retryV2.lease && Date.parse(retryV2.lease.expiresAt) > now.getTime()) {
    return {
      scheduleId: definition.scheduleId,
      contentType,
      scheduleKey: key,
      scheduledFor,
      status: "already_ran",
      attempt: Math.max(1, ...Object.values(retryV2.attempts)),
      referenceAttempt: previousReferenceAttempt,
      generationAttempt: previousGenerationAttempt,
      reason: `${retryV2.lease.phase} 단계가 다른 실행에서 처리 중입니다.`,
    };
  }
  const previousStatus = typeof previousPayload.status === "string" ? previousPayload.status : "";
  if (!options.manualRecovery
    && existing
    && ["failed", "partial_failed", "deferred"].includes(previousStatus)) {
    const delayMs = config.retryDelayMinutes * 60 * 1000;
    const alignmentGraceMs = Math.min(60_000, Math.floor(delayMs * 0.1));
    const remainingMs = Math.max(0, delayMs - alignmentGraceMs - (now.getTime() - existing.timestamp.getTime()));
    if (remainingMs > 0) {
      return {
        scheduleId: definition.scheduleId,
        contentType,
        scheduleKey: key,
        scheduledFor,
        status: "already_ran",
        attempt: Math.max(1, ...Object.values(retryV2.attempts)),
        referenceAttempt: previousReferenceAttempt,
        generationAttempt: previousGenerationAttempt,
        reason: `실패 재시도 대기 중 · 약 ${Math.max(1, Math.ceil(remainingMs / 60_000))}분 후 가능`,
      };
    }
  }
  const dataFallbackCutoffReached = definition.dataFailureFallback === "investment-study"
    && config.weekdayInvestmentStudyEnabled
    && isKisOverseasDegradedCutoffReached(now, definition.dataFailureFallbackAfterKst);
  const phaseBudget = evaluateStockBlogPhaseBudget({
    previousReason,
    referenceAttempt: previousReferenceAttempt,
    generationAttempt: previousGenerationAttempt,
    referenceMaxAttempts: definition.referenceMaxAttempts,
    generationMaxAttempts: definition.generationMaxAttempts,
    dataFallbackCutoffReached,
    manualRecovery: options.manualRecovery,
  });
  if (!phaseBudget.allowed) {
    return {
      scheduleId: definition.scheduleId,
      contentType,
      scheduleKey: key,
      scheduledFor,
      status: "already_ran",
      attempt: typeof previousPayload.attempt === "number" ? previousPayload.attempt : Math.max(previousReferenceAttempt, previousGenerationAttempt),
      referenceAttempt: previousReferenceAttempt,
      generationAttempt: previousGenerationAttempt,
      reason: phaseBudget.reason,
    };
  }
  if (["succeeded", "skipped", "already_ran"].includes(previousStatus)) {
    return {
      scheduleId: definition.scheduleId,
      contentType,
      scheduleKey: key,
      scheduledFor,
      status: "already_ran",
      attempt: Math.max(1, ...Object.values(retryV2.attempts)),
      referenceAttempt: previousReferenceAttempt,
      generationAttempt: previousGenerationAttempt,
      reason: "이미 처리된 스케줄입니다.",
    };
  }
  const attempt = Math.max(1, ...Object.values(retryV2.attempts));
  const marketDecision = await resolveScheduleMarketDecision(contentType, marketDate);
  const marketSession = marketDecision.session;
  const holidaySearchReplacement = marketDecision.action === "skip"
    && marketSession?.state === "closed"
    && config.weekdayInvestmentStudyEnabled;
  const dataFailureStudyFallback = marketDecision.action === "run"
    && !holidaySearchReplacement
    && definition.dataFailureFallback === "investment-study"
    && config.weekdayInvestmentStudyEnabled
    && isStockReferencePreflightFailure(previousReason)
    && dataFallbackCutoffReached;
  const effectiveContentType: StockBlogContentType = holidaySearchReplacement || dataFailureStudyFallback
    ? "INVESTMENT_STUDY"
    : contentType;
  if (marketDecision.action !== "run" && !holidaySearchReplacement) {
    const status: StockBlogSchedulerRunStatus = marketDecision.action === "skip" ? "skipped" : "deferred";
    const result: StockBlogSchedulerRunResult = {
      scheduleId: definition.scheduleId,
      contentType,
      scheduleKey: key,
      scheduledFor,
      status,
      attempt,
      reason: marketDecision.reason,
      marketSession,
    };
    await writeSchedulerEvent({
      key,
      contentType,
      scheduledFor,
      status,
      summary: marketDecision.action === "skip"
        ? `${contentType} 거래소 휴장으로 건너뜀`
        : `${contentType} 거래소 일정 확인 대기`,
      payload: result as unknown as Prisma.InputJsonObject,
    });
    return result;
  }
  if (holidaySearchReplacement) {
    publishKey = getHolidaySearchStudyPublishKey(marketDate);
    const existingHolidayStudy = await prisma.naverDraftJob.findUnique({ where: { publishKey } });
    if (existingHolidayStudy) {
      const result: StockBlogSchedulerRunResult = {
        scheduleId: definition.scheduleId,
        contentType,
        scheduleKey: key,
        scheduledFor,
        status: "already_ran",
        attempt,
        reason: "같은 날짜의 휴장 검색 유입형 투자공부가 이미 생성됐습니다.",
        marketSession,
        holidaySearchReplacement: true,
        replacementContentType: "INVESTMENT_STUDY",
      };
      await writeSchedulerEvent({
        key,
        contentType,
        scheduledFor,
        status: "already_ran",
        summary: `${marketSession?.market ?? "거래소"} 휴장 대체 투자공부 날짜 중복 방지`,
        payload: result as unknown as Prisma.InputJsonObject,
      });
      return result;
    }
  }
  if (dataFailureStudyFallback) {
    publishKey = getMarketDataFallbackStudyPublishKey(marketDate, publishTime);
    const existingFallbackStudy = await prisma.naverDraftJob.findUnique({ where: { publishKey } });
    if (existingFallbackStudy) {
      const result: StockBlogSchedulerRunResult = {
        scheduleId: definition.scheduleId,
        contentType,
        scheduleKey: key,
        scheduledFor,
        status: "already_ran",
        attempt,
        reason: "같은 날짜·시간대의 시장자료 지연 대체 투자공부가 이미 생성됐습니다.",
        dataFailureStudyFallback: true,
        replacementContentType: "INVESTMENT_STUDY",
      };
      await writeSchedulerEvent({
        key,
        contentType,
        scheduledFor,
        status: "already_ran",
        summary: `${contentType} 시장자료 지연 대체 투자공부 중복 방지`,
        payload: result as unknown as Prisma.InputJsonObject,
      });
      return result;
    }
  }
  if (config.autoPublish && !holidaySearchReplacement && !dataFailureStudyFallback) {
    const existingScheduledJob = await prisma.naverDraftJob.findFirst({
      where: { publishKey: { in: [publishKey, ...publishKeyAliases] } },
      orderBy: { createdAt: "desc" },
    });
    if (existingScheduledJob) {
      const result: StockBlogSchedulerRunResult = {
        scheduleId: definition.scheduleId,
        contentType,
        scheduleKey: key,
        scheduledFor,
        status: "already_ran",
        attempt,
        reason: "같은 날짜·시간대의 자동 발행 작업이 이미 생성됐습니다.",
        naverDraftJobId: existingScheduledJob.id,
      };
      await writeSchedulerEvent({
        key,
        contentType,
        scheduledFor,
        status: "already_ran",
        summary: `${contentType} 자동 발행키 중복 방지`,
        payload: result as unknown as Prisma.InputJsonObject,
      });
      return result;
    }
  }
  const resumablePipelineId = retryV2.completed.content_generation ? retryCheckpoint.pipelineId ?? null : null;
  const resumableApprovalId = retryCheckpoint.approvalId;
  let recoveredPipeline: Awaited<ReturnType<typeof findContentPipelineByOperationalAttempt>> = recoveredLegacyPipeline;
  if (!resumablePipelineId
    && retryV2.lease?.phase === "content_generation"
    && Date.parse(retryV2.lease.expiresAt) <= now.getTime()) {
    for (const runKey of Array.from(new Set([key, legacyOperationalRunKey].filter((value): value is string => Boolean(value))))) {
      recoveredPipeline = await findContentPipelineByOperationalAttempt(runKey, retryV2.lease.attempt);
      if (recoveredPipeline) break;
    }
  }

  if (config.runnerMode === "hermes" && !resumablePipelineId && !recoveredPipeline) {
    const requiredRuns = getExpectedHermesRunsForStockBlog(effectiveContentType);
    const usage = usageSnapshot(await getHermesUsageSummary({ recentLimit: 4 }));
    if (usage.remaining < requiredRuns) {
      const result: StockBlogSchedulerRunResult = {
        scheduleId: definition.scheduleId,
        contentType,
        scheduleKey: key,
        scheduledFor,
        status: "deferred",
        attempt,
        referenceAttempt: retryV2.attempts.reference_preflight,
        generationAttempt: retryV2.attempts.content_generation,
        reason: `Hermes 남은 횟수 부족: ${requiredRuns}회 필요, ${usage.remaining}회 남음`,
        hermesUsageBefore: usage,
      };
      await writeSchedulerEvent({
        key,
        contentType,
        scheduledFor,
        status: "deferred",
        summary: `${effectiveContentType} 자동 실행 대기 · Hermes 한도 부족`,
        payload: {
          ...(result as unknown as Prisma.InputJsonObject),
          retryV2: retryStateJson(retryV2),
          retryCheckpoint: retryCheckpointJson(retryCheckpoint),
        },
      });
      return result;
    }
  }

  let activePhase: { phase: StockBlogRetryPhase; token: string } | null = null;
  const settleActivePhase = async (
    succeeded: boolean,
    consumeAttempt = true,
    reopenContentGeneration = false,
    requestReferenceRefresh = false,
  ) => {
    if (!activePhase) return;
    retryV2 = await settleSchedulerPhase({
      key,
      token: activePhase.token,
      succeeded,
      consumeAttempt,
      reopenContentGeneration,
      requestReferenceRefresh,
      checkpoint: retryCheckpoint,
    });
    activePhase = null;
  };
  const resumeDraftAssembly = async (input: {
    pipelineId: string;
    approvalId?: string;
    hermesUsage: { used: number; remaining: number; limit: number };
  }): Promise<StockBlogSchedulerRunResult> => {
    if (config.autoApprove && input.approvalId) {
      const approval = await prisma.approvalRequest.findUnique({
        where: { id: input.approvalId },
        select: { status: true },
      });
      if (approval?.status !== "승인 완료") {
        await resolveApproval({
          approvalId: input.approvalId,
          status: "승인 완료",
          decisionReason: "Stock Blog Scheduler 자동 승인 복구 · 네이버 임시저장 준비",
        });
      }
    }
    const draftClaim = await claimSchedulerPhase({
      key,
      contentType,
      scheduledFor,
      phase: "draft_assembly",
      now,
      seedState: logicalExisting ? undefined : retryV2,
      seedCheckpoint: logicalExisting ? undefined : retryCheckpoint,
    });
    retryV2 = draftClaim.state;
    retryCheckpoint = draftClaim.checkpoint;
    if (draftClaim.action === "blocked") {
      return {
        scheduleId: definition.scheduleId,
        contentType,
        scheduleKey: key,
        scheduledFor,
        status: "already_ran",
        attempt: Math.max(1, ...Object.values(retryV2.attempts)),
        referenceAttempt: retryV2.attempts.reference_preflight,
        generationAttempt: retryV2.attempts.content_generation,
        reason: draftClaim.reason,
        pipelineId: input.pipelineId,
      };
    }
    if (draftClaim.action === "completed") {
      const result: StockBlogSchedulerRunResult = {
        scheduleId: definition.scheduleId,
        contentType,
        scheduleKey: key,
        scheduledFor,
        status: "succeeded",
        attempt: Math.max(1, ...Object.values(retryV2.attempts)),
        referenceAttempt: retryV2.attempts.reference_preflight,
        generationAttempt: retryV2.attempts.content_generation,
        reason: "네이버 작업 조립이 이미 완료됐습니다.",
        pipelineId: input.pipelineId,
        approvalId: input.approvalId,
        naverDraftJobId: retryCheckpoint.naverDraftJobId,
        hermesUsageBefore: input.hermesUsage,
        hermesUsageAfter: input.hermesUsage,
      };
      await writeSchedulerEvent({
        key,
        contentType,
        scheduledFor,
        status: "succeeded",
        summary: `${contentType} 네이버 작업 조립 완료 상태 복구`,
        payload: {
          ...(result as unknown as Prisma.InputJsonObject),
          retryV2: retryStateJson(retryV2),
          retryCheckpoint: retryCheckpointJson(retryCheckpoint),
        },
      });
      return result;
    }
    if (draftClaim.token) activePhase = { phase: "draft_assembly", token: draftClaim.token };
    try {
      const job = await createNaverDraftJobFromPipeline({
        contentPipelineId: input.pipelineId,
        approvalId: input.approvalId,
        allowPublish: config.autoPublish,
        publishKey: config.autoPublish ? publishKey : null,
        publishKeyAliases: config.autoPublish && !holidaySearchReplacement && !dataFailureStudyFallback ? publishKeyAliases : [],
        marketDate: config.autoPublish ? marketDate : null,
        scheduleSlot: config.autoPublish ? publishTime : null,
      });
      retryCheckpoint = { ...retryCheckpoint, naverDraftJobId: job.id };
      await settleActivePhase(true);
      const result: StockBlogSchedulerRunResult = {
        scheduleId: definition.scheduleId,
        contentType,
        scheduleKey: key,
        scheduledFor,
        status: "succeeded",
        attempt: Math.max(1, ...Object.values(retryV2.attempts)),
        referenceAttempt: retryV2.attempts.reference_preflight,
        generationAttempt: retryV2.attempts.content_generation,
        reason: "기존 고품질 파이프라인에서 네이버 작업 조립 복구 완료",
        pipelineId: input.pipelineId,
        approvalId: input.approvalId,
        naverDraftJobId: job.id,
        hermesUsageBefore: input.hermesUsage,
        hermesUsageAfter: input.hermesUsage,
      };
      await writeSchedulerEvent({
        key,
        contentType,
        scheduledFor,
        status: "succeeded",
        summary: `${contentType} 네이버 작업 조립 복구 완료`,
        payload: result as unknown as Prisma.InputJsonObject,
      });
      return result;
    } catch (error) {
      const reason = error instanceof Error ? error.message : "네이버 작업 조립 복구 실패";
      const needsReferenceRefresh = reason.startsWith("NAVER_DRAFT_NEEDS_REFERENCE:");
      const automaticReferenceRegenerationAvailable = retryV2.attempts.content_generation
        < STOCK_BLOG_RETRY_PHASE_LIMITS.content_generation;
      const regenerateContent = needsReferenceRefresh
        || reason.startsWith("NAVER_DRAFT_DUPLICATE_CONTENT_BLOCKED:")
        || reason.startsWith("NAVER_DRAFT_QUALITY_FAILED:")
        || reason.startsWith("NAVER_DRAFT_NEEDS_REFERENCE:");
      if (regenerateContent) {
        retryCheckpoint = needsReferenceRefresh
          ? {}
          : {
              ...retryCheckpoint,
              pipelineId: undefined,
              approvalId: undefined,
              naverDraftJobId: undefined,
            };
      }
      await settleActivePhase(false, !regenerateContent, regenerateContent && !needsReferenceRefresh, needsReferenceRefresh);
      const qualityFailure = regenerateContent || isStockContentQualityFailure(reason);
      const result: StockBlogSchedulerRunResult = {
        scheduleId: definition.scheduleId,
        contentType,
        scheduleKey: key,
        scheduledFor,
        status: "partial_failed",
        attempt: Math.max(1, ...Object.values(retryV2.attempts)),
        referenceAttempt: retryV2.attempts.reference_preflight,
        generationAttempt: retryV2.attempts.content_generation,
        reason: needsReferenceRefresh && automaticReferenceRegenerationAvailable
          ? `STOCK_REFERENCE_PREFLIGHT_BLOCKED: ${reason}`
          : qualityFailure
            ? `STOCK_CONTENT_QUALITY_FAILED: ${reason}`
            : reason,
        pipelineId: input.pipelineId,
        approvalId: input.approvalId,
        hermesUsageBefore: input.hermesUsage,
        hermesUsageAfter: input.hermesUsage,
      };
      await writeSchedulerEvent({
        key,
        contentType,
        scheduledFor,
        status: "partial_failed",
        summary: `${contentType} 네이버 작업 조립 복구 실패`,
        payload: result as unknown as Prisma.InputJsonObject,
      });
      return result;
    }
  };

  if (!resumablePipelineId && !recoveredPipeline && !retryCheckpoint.pipelineInput) {
    const claim = await claimSchedulerPhase({
      key,
      contentType,
      scheduledFor,
      phase: "reference_preflight",
      now,
      seedState: logicalExisting ? undefined : retryV2,
      seedCheckpoint: logicalExisting ? undefined : retryCheckpoint,
      forceReferenceRefresh: retryV2.completed.reference_preflight,
    });
    retryV2 = claim.state;
    retryCheckpoint = claim.checkpoint;
    if (claim.action === "blocked") {
      return {
        scheduleId: definition.scheduleId,
        contentType,
        scheduleKey: key,
        scheduledFor,
        status: "already_ran",
        attempt,
        referenceAttempt: retryV2.attempts.reference_preflight,
        generationAttempt: retryV2.attempts.content_generation,
        reason: claim.reason,
      };
    }
    if (claim.action === "claim" && claim.token) activePhase = { phase: "reference_preflight", token: claim.token };
  }

  let holidaySearchStudyBuild: Awaited<ReturnType<typeof buildHolidaySearchStudyPipelineInput>> | null = null;
  let dataFailureStudyBuild: Awaited<ReturnType<typeof buildMarketDataFallbackStudyPipelineInput>> | null = null;
  try {
    if (holidaySearchReplacement && marketSession && !resumablePipelineId && !recoveredPipeline && !retryCheckpoint.pipelineInput) {
      holidaySearchStudyBuild = await buildHolidaySearchStudyPipelineInput(
        marketSession,
        config.runnerMode,
        scheduledAt,
        config.timezone,
      );
    }
    if (dataFailureStudyFallback && !resumablePipelineId && !recoveredPipeline && !retryCheckpoint.pipelineInput) {
      dataFailureStudyBuild = await buildMarketDataFallbackStudyPipelineInput(
        definition,
        config.runnerMode,
        marketDate,
        scheduledAt,
        config.timezone,
      );
    }
    let investmentStudyBuild: Awaited<ReturnType<typeof buildInvestmentStudyPipelineInput>> | null = null;
    if (contentType === "INVESTMENT_STUDY" && definition.investmentStudyMode && !resumablePipelineId && !recoveredPipeline && !retryCheckpoint.pipelineInput) {
      if (!config.weekdayInvestmentStudyEnabled) {
        await settleActivePhase(false, false);
        const result: StockBlogSchedulerRunResult = {
          scheduleId: definition.scheduleId,
          contentType,
          scheduleKey: key,
          scheduledFor,
          status: "skipped",
          attempt,
          reason: "평일 시장 연결 투자공부 기능이 비활성화되어 있습니다.",
        };
        await writeSchedulerEvent({
          key,
          contentType,
          scheduledFor,
          status: "skipped",
          summary: `${contentType} 평일 투자공부 비활성화`,
          payload: result as unknown as Prisma.InputJsonObject,
        });
        return result;
      }
      if (config.runnerMode === "hermes") {
        const requiredRuns = getExpectedHermesRunsForStockBlog(contentType);
        const usage = usageSnapshot(await getHermesUsageSummary({ recentLimit: 4 }));
        if (usage.remaining < requiredRuns) {
          await settleActivePhase(false, false);
          const result: StockBlogSchedulerRunResult = {
            scheduleId: definition.scheduleId,
            contentType,
            scheduleKey: key,
            scheduledFor,
            status: "deferred",
            attempt,
            reason: `Hermes 남은 횟수 부족: ${requiredRuns}회 필요, ${usage.remaining}회 남음`,
            hermesUsageBefore: usage,
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
      if (
        definition.investmentStudyMode === "conditional"
        && await hasConditionalInvestmentStudyRunThisWeek(now, config.timezone, key)
      ) {
        await settleActivePhase(false, false);
        const result: StockBlogSchedulerRunResult = {
          scheduleId: definition.scheduleId,
          contentType,
          scheduleKey: key,
          scheduledFor,
          status: "skipped",
          attempt,
          reason: "이번 주 조건부 투자공부 1회 한도를 이미 사용했습니다.",
        };
        await writeSchedulerEvent({
          key,
          contentType,
          scheduledFor,
          status: "skipped",
          summary: `${contentType} 조건부 주간 한도 도달`,
          payload: result as unknown as Prisma.InputJsonObject,
        });
        return result;
      }

      investmentStudyBuild = await buildInvestmentStudyPipelineInput(
        definition,
        config.runnerMode,
        scheduledAt,
        config.timezone,
      );
      if (definition.investmentStudyMode === "conditional") {
        const bundle = investmentStudyBuild.input.referenceBundle;
        const dataReady = bundle.status === "ready"
          && bundle.marketSnapshot?.status === "ready"
          && bundle.marketSnapshot?.dataQuality === "verified"
          && bundle.marketSnapshot?.freshness?.status === "fresh";
        if (!dataReady) {
          await settleActivePhase(false);
          const result: StockBlogSchedulerRunResult = {
            scheduleId: definition.scheduleId,
            contentType,
            scheduleKey: key,
            scheduledFor,
            status: "deferred",
            attempt,
            reason: "조건부 투자공부 판단용 시장·검색 데이터가 아직 검증되지 않았습니다.",
            studyTopicMode: investmentStudyBuild.selection.mode,
            studyIssueScore: investmentStudyBuild.selection.score,
            studyIssueReasons: investmentStudyBuild.selection.reasons,
          };
          await writeSchedulerEvent({
            key,
            contentType,
            scheduledFor,
            status: "deferred",
            summary: `${contentType} 조건부 이슈 데이터 재확인 대기`,
            payload: result as unknown as Prisma.InputJsonObject,
          });
          return result;
        }
        if (!qualifiesForConditionalInvestmentStudy(investmentStudyBuild.selection)) {
          await settleActivePhase(true);
          const result: StockBlogSchedulerRunResult = {
            scheduleId: definition.scheduleId,
            contentType,
            scheduleKey: key,
            scheduledFor,
            status: "skipped",
            attempt,
            reason: "검색 유입형 투자공부로 확장할 만큼 강한 코스피·미국장 이슈가 확인되지 않았습니다.",
            studyTopicMode: investmentStudyBuild.selection.mode,
            studyIssueScore: investmentStudyBuild.selection.score,
            studyIssueReasons: investmentStudyBuild.selection.reasons,
          };
          await writeSchedulerEvent({
            key,
            contentType,
            scheduledFor,
            status: "skipped",
            summary: `${contentType} 조건부 이슈 기준 미달`,
            payload: result as unknown as Prisma.InputJsonObject,
          });
          return result;
        }
      }
    }

    let largeCapScan: LargeCapDisclosureScanResult | null = null;
    if (contentType === "LARGE_CAP_DISCLOSURE_EARNINGS" && !resumablePipelineId && !recoveredPipeline && !retryCheckpoint.pipelineInput) {
      if (!config.largeCapEventsEnabled) {
        await settleActivePhase(false, false);
        const result: StockBlogSchedulerRunResult = {
          scheduleId: definition.scheduleId,
          contentType,
          scheduleKey: key,
          scheduledFor,
          status: "skipped",
          attempt,
          reason: "대형주 공시·실적 조건부 감지 기능이 비활성화되어 있습니다.",
        };
        await writeSchedulerEvent({
          key,
          contentType,
          scheduledFor,
          status: "skipped",
          summary: `${contentType} 조건부 감지 비활성화`,
          payload: result as unknown as Prisma.InputJsonObject,
        });
        return result;
      }
      largeCapScan = await scanLargeCapDisclosureEvents({ now });
      if (largeCapScan.events.length === 0) {
        await settleActivePhase(false);
        const providerUnavailable = largeCapScan.providers.openDart !== "ready" && largeCapScan.providers.secEdgar !== "ready";
        const reason = providerUnavailable
          ? `공식 공시 제공자를 조회하지 못했습니다. ${largeCapScan.notes.join(" / ")}`
          : `공식 대형주 공시·실적 발표가 없어 생성하지 않았습니다.${largeCapScan.notes.length ? ` ${largeCapScan.notes.join(" / ")}` : ""}`;
        const result: StockBlogSchedulerRunResult = {
          scheduleId: definition.scheduleId,
          contentType,
          scheduleKey: key,
          scheduledFor,
          status: "deferred",
          attempt,
          reason,
          officialEventCount: 0,
          officialProviders: largeCapScan.providers,
        };
        await writeSchedulerEvent({
          key,
          contentType,
          scheduledFor,
          status: "deferred",
          summary: providerUnavailable ? `${contentType} 공식 제공자 조회 실패` : `${contentType} 공식 발표 없음 · 다음 틱 재확인`,
          payload: {
            ...(result as unknown as Prisma.InputJsonObject),
            monitorNotes: largeCapScan.notes,
            checkedAt: largeCapScan.checkedAt,
          },
        });
        return result;
      }
    }
    let pipelineInput: ContentPipelineInput | undefined = retryCheckpoint.pipelineInput;
    if (!resumablePipelineId && !recoveredPipeline && !pipelineInput) {
      const builtPipelineInput = largeCapScan
        ? await buildLargeCapPipelineInput(definition, config.runnerMode, scheduledAt, config.timezone, largeCapScan)
        : holidaySearchStudyBuild?.input
          ?? dataFailureStudyBuild?.input
          ?? investmentStudyBuild?.input
          ?? buildPipelineInput(definition, config.runnerMode, scheduledAt, config.timezone);
      let preparedPipelineInput: ContentPipelineInput = { ...builtPipelineInput, channel: "blog" } as ContentPipelineInput;
      if (!preparedPipelineInput.referenceBundle) {
        const referenceMarket = [
          "NEXT_WEEK_MARKET_PREVIEW",
          "KOREA_MARKET_CLOSE_US_PREVIEW",
          "INVESTMENT_STUDY",
          "LARGE_CAP_DISCLOSURE_EARNINGS",
        ].includes(effectiveContentType) ? "GLOBAL" : "KR";
        preparedPipelineInput = {
          ...preparedPipelineInput,
          referenceBundle: await collectStockBlogReferences({
            topic: preparedPipelineInput.topic,
            title: preparedPipelineInput.title,
            channel: preparedPipelineInput.channel,
            contentType: effectiveContentType,
            market: referenceMarket,
            keywords: Array.from(new Set(`${preparedPipelineInput.topic} ${preparedPipelineInput.title}`
              .split(/[\s,·/]+/)
              .map((item) => item.trim())
              .filter((item) => item.length >= 2))).slice(0, 8),
            prioritizeInputQueries: effectiveContentType === "INVESTMENT_STUDY",
          }),
        };
      }
      pipelineInput = preparedPipelineInput;
      retryCheckpoint = { ...retryCheckpoint, pipelineInput };
      const referenceGate = evaluateStockBlogReferences(preparedPipelineInput.referenceBundle, config.runnerMode === "hermes");
      if (config.runnerMode === "hermes" && !referenceGate.ok) {
        const error = new Error(`STOCK_REFERENCE_PREFLIGHT_BLOCKED: ${referenceGate.status} · ${referenceGate.reasons.join(" / ")}`);
        Object.assign(error, { code: "STOCK_REFERENCE_PREFLIGHT_BLOCKED", qualityGate: referenceGate });
        throw error;
      }
      await settleActivePhase(true);
    }

    const hermesUsageBefore = usageSnapshot(await getHermesUsageSummary({ recentLimit: 4 }));
    if (resumablePipelineId) {
      return resumeDraftAssembly({
        pipelineId: resumablePipelineId,
        approvalId: resumableApprovalId,
        hermesUsage: hermesUsageBefore,
      });
    }
    let pipeline = recoveredPipeline;
    if (pipeline && retryV2.lease?.phase === "content_generation") {
      activePhase = { phase: "content_generation", token: retryV2.lease.token };
    } else if (pipeline) {
      const recoveredClaim = await claimSchedulerPhase({
        key,
        contentType,
        scheduledFor,
        phase: "content_generation",
        now,
        seedState: logicalExisting ? undefined : retryV2,
        seedCheckpoint: logicalExisting ? undefined : retryCheckpoint,
        maxAttempts: options.manualRecovery ? STOCK_BLOG_MANUAL_RECOVERY_GENERATION_LIMIT : undefined,
      });
      retryV2 = recoveredClaim.state;
      retryCheckpoint = recoveredClaim.checkpoint;
      if (recoveredClaim.action !== "claim" || !recoveredClaim.token) {
        throw new Error(recoveredClaim.reason ?? "STOCK_RETRY_V2_RECOVERED_PIPELINE_CLAIM_FAILED");
      }
      activePhase = { phase: "content_generation", token: recoveredClaim.token };
    }
    if (!pipeline) {
      const generationClaim = await claimSchedulerPhase({
        key,
        contentType,
        scheduledFor,
        phase: "content_generation",
        now,
        seedState: logicalExisting ? undefined : retryV2,
        seedCheckpoint: logicalExisting ? undefined : retryCheckpoint,
        maxAttempts: options.manualRecovery ? STOCK_BLOG_MANUAL_RECOVERY_GENERATION_LIMIT : undefined,
      });
      retryV2 = generationClaim.state;
      retryCheckpoint = generationClaim.checkpoint;
      if (generationClaim.action === "blocked") {
        return {
          scheduleId: definition.scheduleId,
          contentType,
          scheduleKey: key,
          scheduledFor,
          status: "already_ran",
          attempt,
          referenceAttempt: retryV2.attempts.reference_preflight,
          generationAttempt: retryV2.attempts.content_generation,
          reason: generationClaim.reason,
        };
      }
      if (generationClaim.action === "completed" && retryCheckpoint.pipelineId) {
        return resumeDraftAssembly({
          pipelineId: retryCheckpoint.pipelineId,
          approvalId: retryCheckpoint.approvalId,
          hermesUsage: hermesUsageBefore,
        });
      }
      if (!generationClaim.token || !generationClaim.attempt || !pipelineInput) {
        throw new Error("STOCK_RETRY_V2_GENERATION_CHECKPOINT_MISSING");
      }
      activePhase = { phase: "content_generation", token: generationClaim.token };
      pipeline = await findContentPipelineByOperationalAttempt(key, generationClaim.attempt)
        ?? await startContentPipelineFromTrustedInput({
          ...pipelineInput,
          channel: "blog" as const,
          operationalRunKey: key,
          operationalAttempt: generationClaim.attempt,
        });
    }
    if (!pipeline) throw new Error("STOCK_RETRY_V2_PIPELINE_MISSING");
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
    retryCheckpoint = {
      ...retryCheckpoint,
      pipelineId: pipeline.id,
      approvalId: approvalId ?? undefined,
    };
    await settleActivePhase(!qualityBlocked);

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
      const draftClaim = await claimSchedulerPhase({
        key,
        contentType,
        scheduledFor,
        phase: "draft_assembly",
        now,
      });
      retryV2 = draftClaim.state;
      retryCheckpoint = draftClaim.checkpoint;
      if (draftClaim.action === "completed") {
        naverDraftJobId = retryCheckpoint.naverDraftJobId;
      } else if (draftClaim.action === "blocked") {
        status = "partial_failed";
        notes.push(draftClaim.reason ?? "네이버 작업 조립 재시도 한도 도달");
      } else {
        if (draftClaim.token) activePhase = { phase: "draft_assembly", token: draftClaim.token };
        try {
          const job = await createNaverDraftJobFromPipeline({
            contentPipelineId: pipeline.id,
            approvalId,
            allowPublish: config.autoPublish,
            publishKey: config.autoPublish ? publishKey : null,
            publishKeyAliases: config.autoPublish && !holidaySearchReplacement && !dataFailureStudyFallback ? publishKeyAliases : [],
            marketDate: config.autoPublish ? marketDate : null,
            scheduleSlot: config.autoPublish ? publishTime : null,
          });
          naverDraftJobId = job.id;
          retryCheckpoint = { ...retryCheckpoint, naverDraftJobId: job.id };
          await settleActivePhase(true);
        } catch (error) {
          status = "partial_failed";
          const reason = error instanceof Error ? error.message : "네이버 임시저장 job 생성 실패";
          const needsReferenceRefresh = reason.startsWith("NAVER_DRAFT_NEEDS_REFERENCE:");
          const automaticReferenceRegenerationAvailable = retryV2.attempts.content_generation
            < STOCK_BLOG_RETRY_PHASE_LIMITS.content_generation;
          const contentQualityBlocked = needsReferenceRefresh
            || reason.startsWith("NAVER_DRAFT_DUPLICATE_CONTENT_BLOCKED:")
            || reason.startsWith("NAVER_DRAFT_QUALITY_FAILED:")
            || reason.startsWith("NAVER_DRAFT_NEEDS_REFERENCE:");
          if (contentQualityBlocked) {
            retryCheckpoint = needsReferenceRefresh
              ? {}
              : {
                  ...retryCheckpoint,
                  pipelineId: undefined,
                  approvalId: undefined,
                  naverDraftJobId: undefined,
                };
          }
          await settleActivePhase(false, !contentQualityBlocked, contentQualityBlocked && !needsReferenceRefresh, needsReferenceRefresh);
          notes.push(needsReferenceRefresh && automaticReferenceRegenerationAvailable
            ? `STOCK_REFERENCE_PREFLIGHT_BLOCKED: ${reason}`
            : contentQualityBlocked
              ? `STOCK_CONTENT_QUALITY_FAILED: ${reason}`
              : reason);
        }
      }
    }

    const hermesUsageAfter = usageSnapshot(await getHermesUsageSummary({ recentLimit: 4 }));
    const result: StockBlogSchedulerRunResult = {
      scheduleId: definition.scheduleId,
      contentType,
      scheduleKey: key,
      scheduledFor,
      status,
      attempt: Math.max(1, ...Object.values(retryV2.attempts)),
      referenceAttempt: retryV2.attempts.reference_preflight,
      generationAttempt: retryV2.attempts.content_generation,
      reason: notes.join(" · ") || undefined,
      pipelineId: pipeline.id,
      approvalId: approvalId ?? undefined,
      naverDraftJobId,
      hermesUsageBefore,
      hermesUsageAfter,
      qualityGate,
      officialEventCount: largeCapScan?.events.length,
      officialProviders: largeCapScan?.providers,
      studyTopicMode: investmentStudyBuild?.selection.mode,
      studyIssueScore: investmentStudyBuild?.selection.score,
      studyIssueReasons: investmentStudyBuild?.selection.reasons,
      marketSession,
      holidaySearchReplacement,
      dataFailureStudyFallback,
      replacementContentType: holidaySearchReplacement || dataFailureStudyFallback ? "INVESTMENT_STUDY" : undefined,
      nextMarketOpenDate: holidaySearchStudyBuild?.nextOpenDate ?? undefined,
    };
    await writeSchedulerEvent({
      key,
      contentType,
      scheduledFor,
      status,
      summary: holidaySearchReplacement
        ? `${marketSession?.market ?? "거래소"} 휴장 대체 검색 유입형 투자공부 ${status === "succeeded" ? "완료" : "부분 완료"}`
        : dataFailureStudyFallback
          ? `${contentType} 시장자료 지연 대체 검색형 투자공부 ${status === "succeeded" ? "완료" : "부분 완료"}`
          : `${contentType} 자동 실행 ${status === "succeeded" ? "완료" : "부분 완료"}`,
      payload: {
        ...(result as unknown as Prisma.InputJsonObject),
        retryV2: retryStateJson(retryV2),
        retryCheckpoint: retryCheckpointJson(retryCheckpoint),
      },
    });
    return result;
  } catch (error) {
    const reason = error instanceof HermesDailyLimitExceededError ? error.message : error instanceof Error ? error.message : "알 수 없는 스케줄러 오류";
    const referencePreflightFailure = isStockReferencePreflightFailure(reason);
    const capacityDeferred = error instanceof HermesDailyLimitExceededError;
    if (referencePreflightFailure) retryCheckpoint = { ...retryCheckpoint, pipelineInput: undefined };
    if (activePhase) await settleActivePhase(false, !capacityDeferred);
    const qualityGate = error && typeof error === "object" && "qualityGate" in error
      ? (error as { qualityGate?: StockBlogQualityGateResult }).qualityGate
      : undefined;
    const result: StockBlogSchedulerRunResult = {
      scheduleId: definition.scheduleId,
      contentType,
      scheduleKey: key,
      scheduledFor,
      status: capacityDeferred ? "deferred" : "failed",
      attempt: Math.max(1, ...Object.values(retryV2.attempts)),
      referenceAttempt: retryV2.attempts.reference_preflight,
      generationAttempt: retryV2.attempts.content_generation,
      reason,
      qualityGate,
      marketSession,
      holidaySearchReplacement,
      dataFailureStudyFallback,
      replacementContentType: holidaySearchReplacement || dataFailureStudyFallback ? "INVESTMENT_STUDY" : undefined,
      nextMarketOpenDate: holidaySearchStudyBuild?.nextOpenDate ?? undefined,
    };
    await writeSchedulerEvent({
      key,
      contentType,
      scheduledFor,
      status: result.status,
      summary: capacityDeferred
        ? `${effectiveContentType} 자동 실행 대기 · Hermes 한도 부족`
        : holidaySearchReplacement
          ? `${marketSession?.market ?? "거래소"} 휴장 대체 검색 유입형 투자공부 실패`
          : dataFailureStudyFallback
            ? `${contentType} 시장자료 지연 대체 검색형 투자공부 실패`
            : `${contentType} 자동 실행 실패`,
      payload: {
        ...(result as unknown as Prisma.InputJsonObject),
        failurePhase: referencePreflightFailure ? "reference_preflight" : capacityDeferred ? "capacity" : "runtime",
        retryable: referencePreflightFailure || capacityDeferred,
        retryV2: retryStateJson(retryV2),
        retryCheckpoint: retryCheckpointJson(retryCheckpoint),
      },
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

export async function runStockBlogSchedulerRecovery(
  scheduleId: string,
  now = new Date(),
  scheduledDate?: string,
) {
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
  let scheduledAt = getScheduledAtForParts(definition, parts, config.timezone);
  if (scheduledDate) {
    const todayDate = `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
    const recoveryDate = evaluateStockBlogRecoveryDate({
      scheduledDate,
      todayDate,
      weekdays: definition.weekdays,
      maxAgeDays: 7,
    });
    if (!recoveryDate.allowed) {
      return {
        ok: false,
        status: "invalid_schedule_date" as const,
        error: recoveryDate.reason,
        config,
        results: [] as StockBlogSchedulerRunResult[],
      };
    }
    const [year, month, day] = scheduledDate.split("-").map(Number);
    scheduledAt = getScheduledAtForParts(definition, {
      ...parts,
      year,
      month,
      day,
      weekday: new Date(`${scheduledDate}T00:00:00Z`).getUTCDay(),
    }, config.timezone);
  }
  if ((!scheduledDate && !appliesOnWeekday(definition, parts.weekday)) || scheduledAt > now) {
    return {
      ok: true,
      status: "not_due" as const,
      config,
      results: [] as StockBlogSchedulerRunResult[],
    };
  }

  const result = await runOneSchedule(definition, now, config, {
    scheduledAt,
    manualRecovery: true,
  });
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
