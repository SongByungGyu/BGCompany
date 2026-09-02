import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { createAgentRun, updateAgentRunStatus, type AgentRunStatus } from "@/lib/repositories/agent-runs";
import { createEvent } from "@/lib/repositories/events";
import { serializeApproval, serializeTask, serializeTimeline } from "@/lib/repositories/serializers";
import { buildContentPlannerHermesPayload, buildContentWriterHermesPayload, buildMarketingReviewHermesPayload, buildQaAuditHermesPayload, runContentPlannerHermes, runContentWriterHermes, runMarketingReviewHermes, runQaAuditHermes } from "@/lib/hermes/hermes-client";
import { assertHermesDailyRunAvailable } from "@/lib/hermes/hermes-usage";
import { collectStockBlogReferences } from "@/lib/stock-blog/references/reference-adapter";
import { buildBlogImagePrompts } from "@/lib/stock-blog/references/reference-normalizer";
import { evaluateStockBlogPublishQuality, evaluateStockBlogReferences, getRealStockReferences } from "@/lib/stock-blog/quality-gate";
import { FRED_DEGRADED_DISCLOSURE, ensureFredDegradedDisclosure, isAllowedFredDegradedSnapshot } from "@/lib/stock-blog/references/fred-degraded-policy";
import { KIS_SECTOR_DEGRADED_DISCLOSURE, ensureKisSectorDegradedDisclosure, isAllowedKisSectorDegradedSnapshot } from "@/lib/stock-blog/references/kis-sector-degraded-policy";
import { KIS_OVERSEAS_DEGRADED_DISCLOSURE, ensureKisOverseasDegradedDisclosure, isAllowedKisOverseasDegradedSnapshot } from "@/lib/stock-blog/references/kis-overseas-degraded-policy";
import { generateStockBlogImages, type GeneratedStockBlogImages } from "@/lib/stock-blog/stock-blog-image-generator";
import { applyVerifiedSchedule, type VerifiedSchedule, type VerifiedScheduleValidation } from "@/lib/stock-blog/verified-schedule";
import type { HermesRunTelemetry, NormalizedHermesRunResult } from "@/lib/hermes/hermes-types";
import type { BlogImagePrompt, ReferenceBundle, StockReferenceBriefingTemplate } from "@/lib/stock-blog/references/reference-types";
import type { StockBlogContentImage, StockBlogImageQualityAudit } from "@/lib/stock-blog/stock-blog-image-types";
import {
  buildRecentTitleAvoidanceGuideline,
  getStockBlogSearchIntentGuidelines,
  STOCK_BLOG_DISCOVERY_GUIDELINES,
} from "@/lib/stock-blog/stock-blog-discovery";
import {
  getStockBlogEditorialGuidelines,
  STOCK_BLOG_HARD_PROHIBITED_PHRASES,
} from "@/lib/stock-blog/stock-blog-editorial-policy";
import type { ContentChannel, ContentPipelineDetail, ContentPipelineRun, ContentPipelineStatus } from "@/features/content-pipeline/content-pipeline-types";
import {
  buildStockBlogEditorialBenchmark,
  selectSafeEditorialBenchmarkGuidelines,
  STOCK_BLOG_EDITORIAL_QUALITY_TARGET,
  type StockBlogEditorialBenchmark,
} from "@/lib/stock-blog/stock-blog-editorial-benchmark";
import {
  buildStockBlogQaRevisionFeedback,
  selectLatestSuccessfulWriterQaAttempt,
  shouldRetryStockBlogQa,
  STOCK_BLOG_MAX_HERMES_RUNS,
  STOCK_BLOG_MAX_QA_ATTEMPTS,
} from "@/lib/stock-blog/qa-revision-policy";
import { loadApprovedLessonInstructionsForAgents } from "@/lib/operational-learning/operational-learning-service";
import type { OperationalLessonInstruction } from "@/lib/operational-learning/operational-learning-policy";

type ContentPipelineInput = {
  topic: string;
  channel: ContentChannel;
  title: string;
  runnerMode?: "mock" | "hermes-dry-run" | "hermes";
  contentType?: StockReferenceBriefingTemplate;
  referenceBundle?: ReferenceBundle;
  blogImagePrompts?: BlogImagePrompt[];
  editorialBenchmarkGuidelines?: string[];
  approvedLessonsByAgent?: Record<string, OperationalLessonInstruction[]>;
  operationalRunKey?: string;
  operationalAttempt?: number;
};

type PlannerExecution = {
  status: "succeeded" | "failed" | "dry-run";
  taskStatus: "완료" | "오류";
  progress: number;
  currentStep: string;
  outputTitle: string;
  outputSummary: string;
  recentOutput: string;
  result: Record<string, unknown>;
  hermesPayload?: Record<string, unknown>;
  hermesResponse?: Record<string, unknown>;
  agentRunStatus: AgentRunStatus;
  agentRunSummary?: string;
  agentRunError?: string;
  hermesJobId?: string;
};

type MarketingExecution = {
  status: "succeeded" | "failed" | "dry-run";
  taskStatus: "완료" | "오류";
  progress: number;
  currentStep: string;
  outputTitle: string;
  outputSummary: string;
  recentOutput: string;
  result: Record<string, unknown>;
  hermesPayload?: Record<string, unknown>;
  hermesResponse?: Record<string, unknown>;
  agentRunMode: string;
  agentRunStatus: AgentRunStatus;
  agentRunSummary?: string;
  agentRunError?: string;
  hermesJobId?: string;
};

type WriterExecution = MarketingExecution;

type QaExecution = MarketingExecution;

type WriterRevisionContext = {
  revisionAttempt: number;
  previousWriterResult: Record<string, unknown>;
  qaRevisionFeedback: Record<string, unknown>;
};

type WriterQaAttempt = {
  attempt: number;
  writer: WriterExecution;
  qa: QaExecution;
};

type NormalizedPipelineResult = NormalizedHermesRunResult & Record<string, unknown>;

const channels = new Set(["blog", "instagram", "youtube", "newsletter"]);
const stockContentTypes = new Set<StockReferenceBriefingTemplate>([
  "KOREA_DAILY_PREVIEW",
  "KOREA_MARKET_CLOSE_US_PREVIEW",
  "WEEKLY_MARKET_REVIEW",
  "NEXT_WEEK_MARKET_PREVIEW",
  "INVESTMENT_STUDY",
  "LARGE_CAP_DISCLOSURE_EARNINGS",
]);
const HERMES_PIPELINE_REQUIRED_RUNS = STOCK_BLOG_MAX_HERMES_RUNS;

function withMarketDataDisclosure(writer: WriterExecution, referenceBundle?: ReferenceBundle): WriterExecution {
  const snapshot = referenceBundle?.marketSnapshot;
  const fredDegraded = isAllowedFredDegradedSnapshot(snapshot);
  const kisSectorDegraded = isAllowedKisSectorDegradedSnapshot(snapshot);
  const kisOverseasDegraded = isAllowedKisOverseasDegradedSnapshot(snapshot);
  if (!fredDegraded && !kisSectorDegraded && !kisOverseasDegraded) return writer;

  const result = { ...writer.result };
  for (const key of ["fullDraft", "markdownDraft"] as const) {
    const value = result[key];
    if (typeof value === "string") {
      const withFred = ensureFredDegradedDisclosure(value, snapshot);
      const withSector = ensureKisSectorDegradedDisclosure(withFred, snapshot);
      result[key] = ensureKisOverseasDegradedDisclosure(withSector, snapshot);
    }
  }
  const htmlDraft = result.htmlDraft;
  if (typeof htmlDraft === "string") {
    const disclosures = [
      fredDegraded ? FRED_DEGRADED_DISCLOSURE : null,
      kisSectorDegraded ? KIS_SECTOR_DEGRADED_DISCLOSURE : null,
      kisOverseasDegraded ? KIS_OVERSEAS_DEGRADED_DISCLOSURE : null,
    ].filter((item): item is string => typeof item === "string" && !htmlDraft.includes(item));
    if (disclosures.length) {
      result.htmlDraft = `${htmlDraft.trimEnd()}\n${disclosures.map((item) => `<p>${item}</p>`).join("\n")}`;
    }
  }
  return { ...writer, result };
}

function withVerifiedSchedule(writer: WriterExecution, referenceBundle?: ReferenceBundle): WriterExecution {
  if (writer.agentRunStatus !== "succeeded") return writer;
  const applied = applyVerifiedSchedule(writer.result, referenceBundle?.marketSnapshot, {
    contentType: referenceBundle?.contentType,
    references: getRealStockReferences(referenceBundle),
  });
  if (applied.validation.ok) return { ...writer, result: applied.result };

  const outputSummary = `검증 일정 대조 실패: ${applied.validation.issues.join(" / ")}`;
  return {
    ...writer,
    status: "failed",
    taskStatus: "오류",
    progress: 90,
    currentStep: "검증 일정 불일치",
    outputSummary,
    recentOutput: outputSummary,
    agentRunStatus: "failed",
    agentRunSummary: undefined,
    agentRunError: outputSummary,
    result: {
      ...applied.result,
      ok: false,
      errorCode: "VERIFIED_SCHEDULE_VALIDATION_FAILED",
      errorMessage: outputSummary,
    },
  };
}

export function assertValidInput(input: unknown): ContentPipelineInput {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("request body must be a JSON object");
  }
  const body = input as Record<string, unknown>;
  const topic = typeof body.topic === "string" ? body.topic.trim() : "";
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const channel = typeof body.channel === "string" ? body.channel : "";
  const runnerMode = typeof body.runnerMode === "string" ? body.runnerMode : "mock";
  const contentType = typeof body.contentType === "string" && stockContentTypes.has(body.contentType as StockReferenceBriefingTemplate)
    ? body.contentType as StockReferenceBriefingTemplate
    : undefined;
  const operationalRunKey = typeof body.operationalRunKey === "string" && body.operationalRunKey.trim()
    ? body.operationalRunKey.trim().slice(0, 240)
    : undefined;
  const operationalAttempt = typeof body.operationalAttempt === "number" && Number.isInteger(body.operationalAttempt) && body.operationalAttempt > 0
    ? body.operationalAttempt
    : undefined;
  if (!topic) throw new Error("topic is required");
  if (!title) throw new Error("title is required");
  if (!channels.has(channel)) throw new Error("channel must be blog/instagram/youtube/newsletter");
  if (!["mock", "hermes-dry-run", "hermes"].includes(runnerMode)) throw new Error("runnerMode must be mock/hermes-dry-run/hermes");
  const referenceBundle = asReferenceBundle(body.referenceBundle);
  const blogImagePrompts = asBlogImagePrompts(body.blogImagePrompts);
  const editorialBenchmarkGuidelines = asStringArray(body.editorialBenchmarkGuidelines);
  return {
    topic,
    title,
    channel: channel as ContentChannel,
    runnerMode: runnerMode as ContentPipelineInput["runnerMode"],
    contentType,
    referenceBundle,
    blogImagePrompts,
    editorialBenchmarkGuidelines,
    operationalRunKey,
    operationalAttempt,
  };
}

function channelLabel(channel: ContentChannel) {
  if (channel === "instagram") return "Instagram";
  if (channel === "youtube") return "YouTube";
  if (channel === "newsletter") return "Newsletter";
  return "Blog";
}

function toJsonObject(value: Record<string, unknown>): Prisma.InputJsonObject {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonObject;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function executionErrorCode(execution: { result: Record<string, unknown> }) {
  return typeof execution.result.errorCode === "string" ? execution.result.errorCode : "HERMES_AGENT_RUN_FAILED";
}

function asReferenceBundle(value: unknown): ReferenceBundle | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as ReferenceBundle : undefined;
}

function asBlogImagePrompts(value: unknown): BlogImagePrompt[] | undefined {
  return Array.isArray(value) ? value as BlogImagePrompt[] : undefined;
}

function asVerifiedSchedule(value: unknown): VerifiedSchedule | undefined {
  const record = asRecord(value);
  if (record?.source !== "marketSnapshot.upcoming" || record.immutable !== true || !Array.isArray(record.events)) return undefined;
  const events = record.events.flatMap((item) => {
    const event = asRecord(item);
    const date = typeof event?.date === "string" ? event.date : "";
    const eventName = typeof event?.event === "string" ? event.event : "";
    const url = typeof event?.url === "string" ? event.url : "";
    if (!date || !eventName) return [];
    return [{
      date,
      event: eventName,
      market: typeof event?.market === "string" ? event.market : undefined,
      sourceName: typeof event?.sourceName === "string" ? event.sourceName : undefined,
      url,
    }];
  });
  const rawScope = asRecord(record.scope);
  const scope = rawScope ? {
    marketDate: typeof rawScope.marketDate === "string" ? rawScope.marketDate : undefined,
    contentType: typeof rawScope.contentType === "string" && stockContentTypes.has(rawScope.contentType as StockReferenceBriefingTemplate)
      ? rawScope.contentType as StockReferenceBriefingTemplate
      : undefined,
    from: typeof rawScope.from === "string" ? rawScope.from : undefined,
    through: typeof rawScope.through === "string" ? rawScope.through : undefined,
    markets: asStringArray(rawScope.markets) ?? [],
    missingMarkets: asStringArray(rawScope.missingMarkets) ?? [],
  } : undefined;
  return { source: "marketSnapshot.upcoming", immutable: true, scope, events };
}

function asScheduleValidation(value: unknown): VerifiedScheduleValidation | undefined {
  const record = asRecord(value);
  if (!record || typeof record.ok !== "boolean") return undefined;
  const checkedEventCount = asNumber(record.checkedEventCount);
  if (checkedEventCount === undefined) return undefined;
  return {
    ok: record.ok,
    checkedEventCount,
    issues: asStringArray(record.issues) ?? [],
  };
}

function inferReferenceTemplate(input: { topic: string; title: string; contentType?: StockReferenceBriefingTemplate }): StockReferenceBriefingTemplate {
  if (input.contentType) return input.contentType;
  const text = `${input.topic} ${input.title}`;
  if (/공시|실적\s*발표|10-q|10-k|8-k/i.test(text)) return "LARGE_CAP_DISCLOSURE_EARNINGS";
  if (/투자\s*공부|재무제표|주식\s*기초/i.test(text)) return "INVESTMENT_STUDY";
  if (/다음\s*주|next\s*week/i.test(text)) return "NEXT_WEEK_MARKET_PREVIEW";
  if (/주간|이번\s*주|weekly/i.test(text)) return "WEEKLY_MARKET_REVIEW";
  if (/미국|나스닥|S&P|미장|밤/i.test(text)) return "KOREA_MARKET_CLOSE_US_PREVIEW";
  return "KOREA_DAILY_PREVIEW";
}

function inferReferenceMarket(template: StockReferenceBriefingTemplate): "KR" | "US" | "GLOBAL" {
  if (template === "NEXT_WEEK_MARKET_PREVIEW"
    || template === "KOREA_MARKET_CLOSE_US_PREVIEW"
    || template === "INVESTMENT_STUDY"
    || template === "LARGE_CAP_DISCLOSURE_EARNINGS") return "GLOBAL";
  return "KR";
}

function buildReferenceKeywords(input: { topic: string; title: string }) {
  return Array.from(new Set(`${input.topic} ${input.title}`.split(/[\s,·/]+/).map((item) => item.trim()).filter((item) => item.length >= 2))).slice(0, 8);
}

const STOCK_PROHIBITED_PHRASES = [
  ...STOCK_BLOG_HARD_PROHIBITED_PHRASES,
  "존재하지 않는 기사·수치·URL 생성",
  "이미지 프롬프트를 독자용 본문에 출력",
];

function hermesStockContext(data: ContentPipelineInput, agentId: string) {
  return {
    contentType: data.referenceBundle?.contentType,
    marketDate: data.referenceBundle?.marketDate,
    marketSnapshot: data.referenceBundle?.marketSnapshot,
    referenceBundle: data.referenceBundle,
    competitorBlogReferences: data.referenceBundle?.competitorBlogReferences,
    editorialBenchmarkGuidelines: data.editorialBenchmarkGuidelines,
    prohibitedPhrases: STOCK_PROHIBITED_PHRASES,
    approvedLessons: data.approvedLessonsByAgent?.[agentId] ?? [],
  };
}

async function loadRecentEditorialBenchmarkGuidelines(contentType: StockReferenceBriefingTemplate) {
  const events = await prisma.eventLog.findMany({
    where: { type: "StockBlogBenchmarkRecorded" },
    orderBy: { timestamp: "desc" },
    take: 40,
    select: { payload: true },
  });
  const guidelines: string[] = [];
  for (const event of events) {
    const payload = asRecord(event.payload);
    if (payload?.contentType !== contentType) continue;
    const benchmark = asRecord(payload.benchmark);
    const quality = asRecord(benchmark?.quality);
    if (typeof quality?.score !== "number" || quality.score < STOCK_BLOG_EDITORIAL_QUALITY_TARGET) continue;
    const applied = asStringArray(benchmark?.appliedGuidelines) ?? [];
    guidelines.push(...applied);
    if (guidelines.length >= 10) break;
  }
  return Array.from(new Set(guidelines))
    .filter((guideline) => !/(?:CTA.*질문|2,?000~3,?200자|체크리스트.*4~6개|본문 이미지 2~4장|대표·본문 이미지.*3~5장)/i.test(guideline))
    .slice(0, 10);
}

async function enrichContentPipelineInput(input: ContentPipelineInput): Promise<ContentPipelineInput> {
  const contentType = inferReferenceTemplate(input);
  const referenceBundle = input.referenceBundle ?? await collectStockBlogReferences({
    topic: input.topic,
    title: input.title,
    channel: input.channel,
    contentType,
    market: inferReferenceMarket(contentType),
    keywords: buildReferenceKeywords(input),
    prioritizeInputQueries: contentType === "INVESTMENT_STUDY",
  });
  const blogImagePrompts = input.blogImagePrompts ?? buildBlogImagePrompts(referenceBundle);
  const currentGuidelines = selectSafeEditorialBenchmarkGuidelines(referenceBundle.competitorAnalysis);
  const historicalGuidelines = await loadRecentEditorialBenchmarkGuidelines(contentType);
  const recentPublishedTitles = await prisma.naverDraftJob.findMany({
    where: { status: "published" },
    orderBy: { publishedAt: "desc" },
    take: 6,
    select: { title: true },
  });
  const recentTitleGuideline = buildRecentTitleAvoidanceGuideline(recentPublishedTitles.map((post) => post.title));
  const editorialBenchmarkGuidelines = Array.from(new Set([
    ...getStockBlogEditorialGuidelines(contentType),
    ...STOCK_BLOG_DISCOVERY_GUIDELINES,
    ...getStockBlogSearchIntentGuidelines(contentType),
    ...(recentTitleGuideline ? [recentTitleGuideline] : []),
    ...(input.editorialBenchmarkGuidelines ?? []),
    ...currentGuidelines,
    ...historicalGuidelines,
  ])).slice(0, 30);
  const approvedLessonsByAgent = await loadApprovedLessonInstructionsForAgents({
    agentIds: ["content-planner", "marketing-manager", "content-writer", "qa-auditor"],
    area: "stock-blog",
  });
  return { ...input, referenceBundle, blogImagePrompts, editorialBenchmarkGuidelines, approvedLessonsByAgent };
}

function asStringArray(value: unknown) {
  if (!Array.isArray(value)) return undefined;
  const items = value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
  return items.length > 0 ? items : undefined;
}

function asWriterSections(value: unknown) {
  if (!Array.isArray(value)) return undefined;
  const sections = value
    .map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return null;
      const record = item as Record<string, unknown>;
      const heading = typeof record.heading === "string" ? record.heading.trim() : "";
      const body = typeof record.body === "string" ? record.body.trim() : "";
      return heading || body ? { heading, body } : null;
    })
    .filter((item): item is { heading: string; body: string } => Boolean(item));
  return sections.length > 0 ? sections : undefined;
}

function asParseStatus(value: unknown) {
  return value === "json" || value === "json_extracted" || value === "fallback_text" ? value : undefined;
}

function asNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function asHermesRunTelemetry(value: unknown): HermesRunTelemetry | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  const agentId = typeof record.agentId === "string" ? record.agentId : undefined;
  const model = typeof record.model === "string" ? record.model : undefined;
  const durationMs = asNumber(record.durationMs);
  const promptBytes = asNumber(record.promptBytes);
  const outputBytes = asNumber(record.outputBytes);
  const timeoutLimitMs = asNumber(record.timeoutLimitMs);
  if (!agentId || !model || durationMs === undefined || promptBytes === undefined || outputBytes === undefined || timeoutLimitMs === undefined) return undefined;
  return {
    agentId,
    model,
    durationMs,
    promptBytes,
    outputBytes,
    exitCode: asNumber(record.exitCode),
    timeoutLimitMs,
    memoryUsagePercentAtStart: asNumber(record.memoryUsagePercentAtStart),
  };
}

function normalizeResultForMetadata(result: NormalizedPipelineResult): Record<string, unknown> {
  return toJsonObject({
    ok: result.ok,
    provider: result.provider,
    agentId: result.agentId,
    title: result.title,
    summary: result.summary,
    content: result.content,
    draftDirection: result.draftDirection,
    outline: result.outline,
    seoKeywords: result.seoKeywords,
    targetAudience: result.targetAudience,
    tone: result.tone,
    thumbnailIdea: result.thumbnailIdea,
    cta: result.cta,
    finalTitle: result.finalTitle,
    metaDescription: result.metaDescription,
    introduction: result.introduction,
    sections: result.sections,
    conclusion: result.conclusion,
    fullDraft: result.fullDraft,
    markdownDraft: result.markdownDraft,
    htmlDraft: result.htmlDraft,
    usedSeoKeywords: result.usedSeoKeywords,
    writingNotes: result.writingNotes,
    verifiedSchedule: result.verifiedSchedule,
    scheduleValidation: result.scheduleValidation,
    referenceBundle: result.referenceBundle,
    blogImagePrompts: result.blogImagePrompts,
    reviewSummary: result.reviewSummary,
    titleSuggestions: result.titleSuggestions,
    recommendedTitle: result.recommendedTitle,
    thumbnailCopy: result.thumbnailCopy,
    introHook: result.introHook,
    promotionCopy: result.promotionCopy,
    clickPoints: result.clickPoints,
    riskNotes: result.riskNotes,
    improvementSuggestions: result.improvementSuggestions,
    marketingScore: result.marketingScore,
    qaSummary: result.qaSummary,
    factCheckNotes: result.factCheckNotes,
    qualityNotes: result.qualityNotes,
    typoAndStyleNotes: result.typoAndStyleNotes,
    requiredRevisions: result.requiredRevisions,
    optionalSuggestions: result.optionalSuggestions,
    publishReadiness: result.publishReadiness,
    qaScore: result.qaScore,
    finalRecommendation: result.finalRecommendation,
    reason: result.reason,
    parseStatus: result.parseStatus,
    rawText: result.rawText,
    hermesJobId: result.hermesJobId,
    durationMs: result.durationMs,
    telemetry: result.telemetry,
    errorCode: result.errorCode,
    errorMessage: result.errorMessage,
    raw: result.raw,
  });
}

function pipelineMetadata(input: {
  pipelineId: string;
  topic: string;
  channel: ContentChannel;
  title: string;
  runnerMode: string;
  taskIds: string[];
  approvalId: string;
  outputTitle: string;
  outputSummary: string;
  plannerResult: Record<string, unknown>;
  marketingResult?: Record<string, unknown>;
  writerResult?: Record<string, unknown>;
  qaResult?: Record<string, unknown>;
  hermesRequestPayload?: Record<string, unknown>;
  hermesMarketingRequestPayload?: Record<string, unknown>;
  hermesWriterRequestPayload?: Record<string, unknown>;
  hermesQaRequestPayload?: Record<string, unknown>;
  referenceBundle?: ReferenceBundle;
  blogImagePrompts?: BlogImagePrompt[];
  qualityGate?: ContentPipelineRun["qualityGate"];
  editorialBenchmark?: StockBlogEditorialBenchmark;
  generatedImages?: GeneratedStockBlogImages;
  revisionHistory?: Array<Record<string, unknown>>;
}): Prisma.InputJsonObject {
  return toJsonObject({
    contentPipelineId: input.pipelineId,
    topic: input.topic,
    channel: input.channel,
    title: input.title,
    runnerMode: input.runnerMode,
    taskIds: input.taskIds,
    approvalId: input.approvalId,
    outputTitle: input.outputTitle,
    outputSummary: input.outputSummary,
    plannerResult: input.plannerResult,
    marketingResult: input.marketingResult,
    writerResult: input.writerResult,
    qaResult: input.qaResult,
    referenceBundle: input.referenceBundle,
    blogImagePrompts: input.blogImagePrompts,
    qualityGate: input.qualityGate,
    editorialBenchmark: input.editorialBenchmark,
    thumbnailImageUrl: input.generatedImages?.thumbnailImageUrl,
    inlineImageUrls: input.generatedImages?.inlineImageUrls,
    contentImages: input.generatedImages?.contentImages,
    imageQuality: input.generatedImages?.imageQuality,
    imageStatus: input.generatedImages?.imageStatus,
    imageGeneratedAt: input.generatedImages?.imageGeneratedAt,
    imageErrorMessage: input.generatedImages?.imageErrorMessage,
    hermesRequestPayload: input.hermesRequestPayload,
    hermesMarketingRequestPayload: input.hermesMarketingRequestPayload,
    hermesWriterRequestPayload: input.hermesWriterRequestPayload,
    hermesQaRequestPayload: input.hermesQaRequestPayload,
    revisionHistory: input.revisionHistory,
  });
}

async function createPipelineAgentRun(input: {
  pipelineId: string;
  taskId: string;
  employeeId: string;
  mode: string;
  status: AgentRunStatus;
  summary?: string;
  errorMessage?: string;
  hermesJobId?: string;
  metadata: Record<string, unknown>;
}) {
  const runId = `run-${randomUUID()}`;
  await createAgentRun({
    id: runId,
    taskId: input.taskId,
    employeeId: input.employeeId,
    mode: input.mode,
    status: "running",
    triggerSource: "content-pipeline",
    startedAt: new Date(),
    metadata: toJsonObject({
      contentPipelineId: input.pipelineId,
      ...input.metadata,
    }),
  });
  return updateAgentRunStatus({
    id: runId,
    status: input.status,
    completedAt: new Date(),
    resultSummary: input.summary ?? null,
    errorMessage: input.errorMessage ?? null,
    hermesJobId: input.hermesJobId ?? null,
    metadata: toJsonObject({
      contentPipelineId: input.pipelineId,
      ...input.metadata,
      resultSummary: input.summary,
      errorMessage: input.errorMessage,
      hermesJobId: input.hermesJobId,
    }),
  });
}

function mockPlannerExecution(data: ContentPipelineInput): PlannerExecution {
  const outputTitle = `${data.title} · ${channelLabel(data.channel)} 초안`;
  const outputSummary = `${data.topic} 주제로 기획, 마케팅 검토, QA 검토를 완료하고 Director 승인을 요청했습니다.`;
  return {
    status: "succeeded",
    taskStatus: "완료",
    progress: 100,
    currentStep: "기획 완료",
    outputTitle,
    outputSummary,
    recentOutput: outputTitle,
    agentRunStatus: "succeeded",
    agentRunSummary: "콘텐츠 기획 초안 생성 완료",
    result: {
      ok: true,
      provider: "mock",
      agentId: "content-planner",
      title: outputTitle,
      summary: outputSummary,
      outline: ["시장 한 줄 요약", "주요 지수/섹터 흐름", "내일 체크포인트", "투자 유의사항"],
      content: `${data.topic}를 ${channelLabel(data.channel)} 콘텐츠로 정리하는 mock 초안 방향입니다.`,
      draftDirection: "독자가 시장 흐름과 체크포인트를 빠르게 파악할 수 있는 데일리 브리핑 형식으로 구성합니다.",
      seoKeywords: ["한국증시", "미국증시", "주식시장", "시장브리핑"],
      targetAudience: "한국·미국 주식시장 흐름을 매일 빠르게 확인하고 싶은 투자자",
      tone: "차분하고 객관적인 시장 브리핑 톤",
      thumbnailIdea: "상승·하락 지수 그래프와 오늘의 체크포인트가 보이는 금융 리포트형 썸네일",
      cta: "내일 장을 보기 전 체크포인트를 함께 확인해보세요.",
      parseStatus: "json",
      durationMs: 0,
    },
  };
}

function dryRunPlannerExecution(data: ContentPipelineInput): PlannerExecution {
  const hermesPayload = buildContentPlannerHermesPayload({
    topic: data.topic,
    title: data.title,
    channel: data.channel,
    language: "ko",
    ...hermesStockContext(data, "content-planner"),
  });
  const outputTitle = `${data.title} · Hermes dry-run payload`;
  const outputSummary = "Hermes를 실제 호출하지 않고 content-planner 요청 payload를 생성했습니다.";
  return {
    status: "dry-run",
    taskStatus: "완료",
    progress: 100,
    currentStep: "Hermes dry-run payload 생성",
    outputTitle,
    outputSummary,
    recentOutput: outputTitle,
    agentRunStatus: "succeeded",
    agentRunSummary: outputSummary,
    hermesPayload: toJsonObject(hermesPayload),
    result: {
      ok: true,
      provider: "hermes",
      agentId: "content-planner",
      title: outputTitle,
      summary: outputSummary,
      outline: ["Hermes 요청 payload 검증", "계약 필드 확인", "실제 호출 전 점검"],
      seoKeywords: ["Hermes", "content-planner", "dry-run"],
      targetAudience: "운영 전 payload를 점검하는 관리자",
      tone: "검증 중심",
      cta: "payload 확인 후 필요할 때만 실제 Hermes 실행을 진행하세요.",
      parseStatus: "json",
      durationMs: 0,
    },
  };
}

async function hermesPlannerExecution(data: ContentPipelineInput): Promise<PlannerExecution> {
  const { payload, result } = await runContentPlannerHermes({
    topic: data.topic,
    title: data.title,
    channel: data.channel,
    language: "ko",
    ...hermesStockContext(data, "content-planner"),
  });
  const hermesPayload = toJsonObject(payload);
  const normalizedResult = normalizeResultForMetadata(result);

  if (!result.ok) {
    const outputTitle = `${data.title} · Hermes 실행 실패`;
    const outputSummary = result.errorMessage ?? "Hermes content-planner 실행에 실패했습니다.";
    return {
      status: "failed",
      taskStatus: "오류",
      progress: 30,
      currentStep: "Hermes 실행 실패",
      outputTitle,
      outputSummary,
      recentOutput: outputSummary,
      agentRunStatus: "failed",
      agentRunError: outputSummary,
      hermesPayload,
      hermesResponse: normalizedResult,
      result: normalizedResult,
    };
  }

  const outputTitle = result.title ?? `${data.title} · Hermes 기획안`;
  const outputSummary = result.summary ?? result.draftDirection ?? "Hermes content-planner가 콘텐츠 기획 결과를 반환했습니다.";
  return {
    status: "succeeded",
    taskStatus: "완료",
    progress: 100,
    currentStep: "Hermes 기획 완료",
    outputTitle,
    outputSummary,
    recentOutput: outputTitle,
    agentRunStatus: "succeeded",
    agentRunSummary: outputSummary,
    hermesJobId: result.hermesJobId,
    hermesPayload,
    hermesResponse: normalizedResult,
    result: normalizedResult,
  };
}

async function executePlanner(data: ContentPipelineInput): Promise<PlannerExecution> {
  const runnerMode = data.runnerMode ?? "mock";
  if (runnerMode === "hermes-dry-run") return dryRunPlannerExecution(data);
  if (runnerMode === "hermes") return hermesPlannerExecution(data);
  return mockPlannerExecution(data);
}

function mockMarketingExecution(data: ContentPipelineInput, planner: PlannerExecution): MarketingExecution {
  const recommendedTitle = planner.result.title && typeof planner.result.title === "string" ? planner.result.title : data.title;
  const reviewSummary = `${recommendedTitle}의 제목, 썸네일, SEO, 홍보 문구를 mock 기준으로 검토했습니다.`;
  return {
    status: "succeeded",
    taskStatus: "완료",
    progress: 100,
    currentStep: "마케팅 검토 완료",
    outputTitle: "마케팅 검토안 생성",
    outputSummary: reviewSummary,
    recentOutput: "제목/홍보 문구 검토안 생성",
    agentRunMode: "mock",
    agentRunStatus: "succeeded",
    agentRunSummary: reviewSummary,
    result: {
      ok: true,
      provider: "mock",
      agentId: "marketing-manager",
      reviewSummary,
      titleSuggestions: [recommendedTitle, `${recommendedTitle} · 오늘 시장 핵심 체크포인트`, `${data.topic} 데일리 브리핑`],
      recommendedTitle,
      thumbnailCopy: "오늘 증시 핵심 체크",
      seoKeywords: ["한국증시", "미국증시", "코스피", "투자체크포인트"],
      introHook: "오늘 시장에서 투자자가 가장 먼저 확인해야 할 흐름은 무엇일까요?",
      promotionCopy: { short: "오늘 한국 증시 흐름과 내일 체크포인트를 정리했습니다.", long: "주요 지수, 섹터 움직임, 투자자 체크리스트를 네이버 블로그용 브리핑 형식으로 정리합니다." },
      clickPoints: ["시장 한 줄 요약", "주요 섹터 흐름", "내일 체크포인트"],
      riskNotes: ["과장된 자동화 표현은 피하고 현재 구현 범위를 명확히 표시"],
      improvementSuggestions: ["초반에 시장 방향성을 먼저 요약하고 지수/섹터/체크리스트 순서로 정리"],
      marketingScore: 82,
      finalRecommendation: "approve",
      reason: "시장 브리핑 주제와 독자 체크포인트의 연결성이 명확합니다.",
      parseStatus: "json",
      durationMs: 0,
    },
  };
}

function dryRunMarketingExecution(data: ContentPipelineInput, planner: PlannerExecution): MarketingExecution {
  const hermesPayload = buildMarketingReviewHermesPayload({
    topic: data.topic,
    title: data.title,
    channel: data.channel,
    language: "ko",
    ...hermesStockContext(data, "marketing-manager"),
    plannerResult: planner.result,
  });
  const outputSummary = "Hermes를 실제 호출하지 않고 marketing-manager 요청 payload를 생성했습니다.";
  return {
    status: "dry-run",
    taskStatus: "완료",
    progress: 100,
    currentStep: "Hermes marketing dry-run payload 생성",
    outputTitle: `${data.title} · Marketing Hermes dry-run payload`,
    outputSummary,
    recentOutput: "marketing-manager payload 생성",
    agentRunMode: "hermes-dry-run",
    agentRunStatus: "succeeded",
    agentRunSummary: outputSummary,
    hermesPayload: toJsonObject(hermesPayload),
    result: {
      ok: true,
      provider: "hermes",
      agentId: "marketing-manager",
      reviewSummary: outputSummary,
      titleSuggestions: [data.title],
      recommendedTitle: data.title,
      thumbnailCopy: "dry-run thumbnail copy",
      seoKeywords: ["Hermes", "marketing-manager", "dry-run"],
      introHook: "dry-run hook",
      promotionCopy: { short: "dry-run short copy", long: "dry-run long copy" },
      clickPoints: ["payload 검증"],
      riskNotes: ["실제 호출 없음"],
      improvementSuggestions: ["payload 확인 후 실제 실행"],
      marketingScore: 0,
      finalRecommendation: "revise",
      reason: "dry-run 결과입니다.",
      parseStatus: "json",
      durationMs: 0,
    },
  };
}

async function hermesMarketingExecution(data: ContentPipelineInput, planner: PlannerExecution): Promise<MarketingExecution> {
  if (planner.agentRunStatus === "failed") {
    const outputSummary = "content-planner 실패로 marketing-manager Hermes 실행을 건너뛰었습니다.";
    return {
      status: "failed",
      taskStatus: "오류",
      progress: 0,
      currentStep: "content-planner 확인 필요",
      outputTitle: `${data.title} · 마케팅 실행 보류`,
      outputSummary,
      recentOutput: outputSummary,
      agentRunMode: "hermes-skipped",
      agentRunStatus: "failed",
      agentRunError: outputSummary,
      result: {
        ok: false,
        provider: "hermes-bridge",
        agentId: "marketing-manager",
        errorCode: "MARKETING_SKIPPED_AFTER_PLANNER_FAILURE",
        errorMessage: outputSummary,
      },
    };
  }

  const { payload, result } = await runMarketingReviewHermes({
    topic: data.topic,
    title: data.title,
    channel: data.channel,
    language: "ko",
    ...hermesStockContext(data, "marketing-manager"),
    plannerResult: planner.result,
  });
  const hermesPayload = toJsonObject(payload);
  const normalizedResult = normalizeResultForMetadata({ ...(result as NormalizedPipelineResult), referenceBundle: data.referenceBundle, blogImagePrompts: data.blogImagePrompts });

  if (!result.ok) {
    const outputTitle = `${data.title} · Marketing Hermes 실행 실패`;
    const outputSummary = result.errorMessage ?? "Hermes marketing-manager 실행에 실패했습니다.";
    return {
      status: "failed",
      taskStatus: "오류",
      progress: 30,
      currentStep: "Marketing Hermes 실행 실패",
      outputTitle,
      outputSummary,
      recentOutput: outputSummary,
      agentRunMode: "hermes",
      agentRunStatus: "failed",
      agentRunError: outputSummary,
      hermesPayload,
      hermesResponse: normalizedResult,
      result: normalizedResult,
    };
  }

  const outputTitle = result.recommendedTitle ?? `${data.title} · 마케팅 검토안`;
  const outputSummary = result.reviewSummary ?? result.reason ?? "Hermes marketing-manager가 마케팅 검토 결과를 반환했습니다.";
  return {
    status: "succeeded",
    taskStatus: "완료",
    progress: 100,
    currentStep: "Hermes 마케팅 검토 완료",
    outputTitle,
    outputSummary,
    recentOutput: outputTitle,
    agentRunMode: "hermes",
    agentRunStatus: "succeeded",
    agentRunSummary: outputSummary,
    hermesJobId: result.hermesJobId,
    hermesPayload,
    hermesResponse: normalizedResult,
    result: normalizedResult,
  };
}

async function executeMarketing(data: ContentPipelineInput, planner: PlannerExecution): Promise<MarketingExecution> {
  const runnerMode = data.runnerMode ?? "mock";
  if (runnerMode === "hermes-dry-run") return dryRunMarketingExecution(data, planner);
  if (runnerMode === "hermes") return hermesMarketingExecution(data, planner);
  return mockMarketingExecution(data, planner);
}


function mockWriterExecution(data: ContentPipelineInput, planner: PlannerExecution, marketing: MarketingExecution): WriterExecution {
  const finalTitle = typeof marketing.result.recommendedTitle === "string" ? marketing.result.recommendedTitle : planner.outputTitle;
  const introduction = `${data.topic}를 독자가 빠르게 이해할 수 있도록 정리한 네이버 블로그용 시장 브리핑 mock 도입부입니다.`;
  const fullDraft = [
    `# ${finalTitle}`,
    "",
    introduction,
    "",
    "## 시장 한 줄 요약",
    "오늘 시장의 방향성과 투자 심리에 영향을 준 핵심 흐름을 간단히 정리합니다.",
    "",
    "## 주요 지수와 섹터 흐름",
    "코스피·코스닥 흐름과 강세/약세 섹터를 나누어 확인합니다.",
    "",
    "## 내일 체크포인트",
    "환율, 금리, 주요 이벤트, 미국장 흐름을 함께 확인합니다.",
  ].join("\n");
  const outputSummary = "content-writer가 mock 게시 초안을 작성했습니다.";
  return {
    status: "succeeded",
    taskStatus: "완료",
    progress: 100,
    currentStep: "본문 초안 작성 완료",
    outputTitle: finalTitle,
    outputSummary,
    recentOutput: "게시용 본문 초안 작성",
    agentRunMode: "mock",
    agentRunStatus: "succeeded",
    agentRunSummary: outputSummary,
    result: {
      ok: true,
      provider: "mock",
      agentId: "content-writer",
      finalTitle,
      metaDescription: `${data.topic}를 네이버 블로그 시장 브리핑 형식으로 정리한 콘텐츠 초안입니다.`,
      introduction,
      sections: [
        { heading: "시장 한 줄 요약", body: "오늘 시장의 방향성과 투자 심리에 영향을 준 핵심 흐름을 요약합니다." },
        { heading: "주요 지수와 섹터 흐름", body: "코스피·코스닥 흐름과 강세/약세 섹터를 구분해 정리합니다." },
        { heading: "내일 체크포인트", body: "환율, 금리, 주요 이벤트, 미국장 흐름을 함께 확인합니다." },
      ],
      conclusion: "시장 브리핑은 매일 같은 기준으로 흐름을 기록할 때 더 유용해집니다.",
      cta: "내일 장을 보기 전 체크포인트를 함께 확인해보세요.",
      fullDraft,
      markdownDraft: fullDraft,
      usedSeoKeywords: ["한국증시", "미국증시", "주식시장", "시장브리핑"],
      writingNotes: ["마케팅 추천 제목과 시장 브리핑 outline을 반영했습니다.", "참고자료 묶음과 이미지 프롬프트 정책을 함께 반영했습니다."],
      referenceBundle: data.referenceBundle,
      blogImagePrompts: data.blogImagePrompts,
      parseStatus: "json",
      durationMs: 0,
      plannerResult: planner.result,
      marketingResult: marketing.result,
    },
  };
}

function dryRunWriterExecution(data: ContentPipelineInput, planner: PlannerExecution, marketing: MarketingExecution): WriterExecution {
  const hermesPayload = buildContentWriterHermesPayload({
    topic: data.topic,
    title: data.title,
    channel: data.channel,
    language: "ko",
    ...hermesStockContext(data, "content-writer"),
    plannerResult: planner.result,
    marketingResult: marketing.result,
    referenceBundle: data.referenceBundle,
    blogImagePrompts: data.blogImagePrompts,
  });
  const outputSummary = "Hermes를 실제 호출하지 않고 content-writer 요청 payload를 생성했습니다.";
  return {
    status: "dry-run",
    taskStatus: "완료",
    progress: 100,
    currentStep: "Hermes writer dry-run payload 생성",
    outputTitle: `${data.title} · Writer Hermes dry-run payload`,
    outputSummary,
    recentOutput: "content-writer payload 생성",
    agentRunMode: "hermes-dry-run",
    agentRunStatus: "succeeded",
    agentRunSummary: outputSummary,
    hermesPayload: toJsonObject(hermesPayload),
    result: {
      ok: true,
      provider: "hermes",
      agentId: "content-writer",
      finalTitle: data.title,
      metaDescription: outputSummary,
      introduction: "dry-run: 실제 본문 작성은 실행하지 않았습니다.",
      sections: [{ heading: "payload 검증", body: "content-writer 요청 구조만 검증했습니다." }],
      conclusion: "dry-run 결과입니다.",
      cta: "payload 확인 후 실제 Hermes 실행을 진행하세요.",
      fullDraft: "dry-run writer payload only",
      markdownDraft: "dry-run writer payload only",
      usedSeoKeywords: ["Hermes", "content-writer", "dry-run"],
      writingNotes: ["실제 호출 없음", "참고자료/이미지 프롬프트 payload 포함"],
      referenceBundle: data.referenceBundle,
      blogImagePrompts: data.blogImagePrompts,
      parseStatus: "json",
      durationMs: 0,
    },
  };
}

async function hermesWriterExecution(
  data: ContentPipelineInput,
  planner: PlannerExecution,
  marketing: MarketingExecution,
  revision?: WriterRevisionContext,
): Promise<WriterExecution> {
  if (planner.agentRunStatus === "failed") {
    const outputSummary = "content-planner 실패로 content-writer Hermes 실행을 건너뛰었습니다.";
    return {
      status: "failed",
      taskStatus: "오류",
      progress: 0,
      currentStep: "content-planner 확인 필요",
      outputTitle: `${data.title} · 본문 작성 보류`,
      outputSummary,
      recentOutput: outputSummary,
      agentRunMode: "hermes-skipped",
      agentRunStatus: "failed",
      agentRunError: outputSummary,
      result: {
        ok: false,
        provider: "hermes-bridge",
        agentId: "content-writer",
        errorCode: "WRITER_SKIPPED_AFTER_PLANNER_FAILURE",
        errorMessage: outputSummary,
      },
    };
  }
  if (marketing.agentRunStatus === "failed") {
    const outputSummary = "marketing-manager 실패로 content-writer Hermes 실행을 건너뛰었습니다.";
    return {
      status: "failed",
      taskStatus: "오류",
      progress: 0,
      currentStep: "marketing-manager 확인 필요",
      outputTitle: `${data.title} · 본문 작성 보류`,
      outputSummary,
      recentOutput: outputSummary,
      agentRunMode: "hermes-skipped",
      agentRunStatus: "failed",
      agentRunError: outputSummary,
      result: {
        ok: false,
        provider: "hermes-bridge",
        agentId: "content-writer",
        errorCode: "WRITER_SKIPPED_AFTER_MARKETING_FAILURE",
        errorMessage: outputSummary,
      },
    };
  }

  const { payload, result } = await runContentWriterHermes({
    topic: data.topic,
    title: data.title,
    channel: data.channel,
    language: "ko",
    ...hermesStockContext(data, "content-writer"),
    plannerResult: planner.result,
    marketingResult: marketing.result,
    referenceBundle: data.referenceBundle,
    blogImagePrompts: data.blogImagePrompts,
    revisionAttempt: revision?.revisionAttempt,
    previousWriterResult: revision?.previousWriterResult,
    qaRevisionFeedback: revision?.qaRevisionFeedback,
  });
  const hermesPayload = toJsonObject(payload);
  const normalizedResult = normalizeResultForMetadata(result as NormalizedPipelineResult);

  if (!result.ok) {
    const outputTitle = `${data.title} · Writer Hermes 실행 실패`;
    const outputSummary = result.errorMessage ?? "Hermes content-writer 실행에 실패했습니다.";
    return {
      status: "failed",
      taskStatus: "오류",
      progress: 30,
      currentStep: "Writer Hermes 실행 실패",
      outputTitle,
      outputSummary,
      recentOutput: outputSummary,
      agentRunMode: "hermes",
      agentRunStatus: "failed",
      agentRunError: outputSummary,
      hermesPayload,
      hermesResponse: normalizedResult,
      result: normalizedResult,
    };
  }

  const outputTitle = result.finalTitle ?? `${data.title} · 본문 초안`;
  const outputSummary = result.metaDescription ?? result.introduction ?? "Hermes content-writer가 게시용 본문 초안을 반환했습니다.";
  return {
    status: "succeeded",
    taskStatus: "완료",
    progress: 100,
    currentStep: "Hermes 본문 초안 작성 완료",
    outputTitle,
    outputSummary,
    recentOutput: outputTitle,
    agentRunMode: "hermes",
    agentRunStatus: "succeeded",
    agentRunSummary: outputSummary,
    hermesJobId: result.hermesJobId,
    hermesPayload,
    hermesResponse: normalizedResult,
    result: normalizedResult,
  };
}

async function executeWriter(
  data: ContentPipelineInput,
  planner: PlannerExecution,
  marketing: MarketingExecution,
  revision?: WriterRevisionContext,
): Promise<WriterExecution> {
  const runnerMode = data.runnerMode ?? "mock";
  if (runnerMode === "hermes-dry-run") return dryRunWriterExecution(data, planner, marketing);
  if (runnerMode === "hermes") return hermesWriterExecution(data, planner, marketing, revision);
  return mockWriterExecution(data, planner, marketing);
}

function mockQaExecution(data: ContentPipelineInput, planner: PlannerExecution, marketing: MarketingExecution, writer: WriterExecution): QaExecution {
  const qaSummary = `${data.title} was reviewed by qa-auditor for factual consistency, quality, and publishing risk in mock mode.`;
  return {
    status: "succeeded",
    taskStatus: "완료",
    progress: 100,
    currentStep: "QA review completed",
    outputTitle: "QA review result generated",
    outputSummary: qaSummary,
    recentOutput: "QA review result and publish readiness notes",
    agentRunMode: "mock",
    agentRunStatus: "succeeded",
    agentRunSummary: qaSummary,
    result: {
      ok: true,
      provider: "mock",
      agentId: "qa-auditor",
      qaSummary,
      factCheckNotes: ["Core claims are consistent with the given topic and previous outputs."],
      qualityNotes: ["The structure is clear enough to move to Director approval."],
      riskNotes: ["Check exaggeration and sensitive details once before publishing.", "이미지 프롬프트에 로고/실제 지수/매수·매도 추천 표현이 없는지 확인합니다."],
      referenceBundle: data.referenceBundle,
      blogImagePrompts: data.blogImagePrompts,
      typoAndStyleNotes: ["No critical typo or style issue was found in mock review."],
      requiredRevisions: [],
      optionalSuggestions: ["Add one concrete operating context sentence to strengthen the opening."],
      publishReadiness: "ready",
      qaScore: 88,
      finalRecommendation: "approve",
      reason: "No mandatory revision is required before Director approval.",
      parseStatus: "json",
      durationMs: 0,
      plannerResult: planner.result,
      marketingResult: marketing.result,
      writerResult: writer.result,
    },
  };
}

function dryRunQaExecution(data: ContentPipelineInput, planner: PlannerExecution, marketing: MarketingExecution, writer: WriterExecution): QaExecution {
  const hermesPayload = buildQaAuditHermesPayload({
    topic: data.topic,
    title: data.title,
    channel: data.channel,
    language: "ko",
    ...hermesStockContext(data, "qa-auditor"),
    plannerResult: planner.result,
    marketingResult: marketing.result,
    writerResult: writer.result,
    referenceBundle: data.referenceBundle,
    blogImagePrompts: data.blogImagePrompts,
  });
  const outputSummary = "qa-auditor Hermes payload was generated without calling Hermes.";
  return {
    status: "dry-run",
    taskStatus: "완료",
    progress: 100,
    currentStep: "Hermes QA dry-run payload generated",
    outputTitle: `${data.title} · QA Hermes dry-run payload`,
    outputSummary,
    recentOutput: "qa-auditor payload generated",
    agentRunMode: "hermes-dry-run",
    agentRunStatus: "succeeded",
    agentRunSummary: outputSummary,
    hermesPayload: toJsonObject(hermesPayload),
    result: {
      ok: true,
      provider: "hermes",
      agentId: "qa-auditor",
      qaSummary: outputSummary,
      factCheckNotes: ["dry-run: no real fact checking was executed."],
      qualityNotes: ["dry-run: payload shape was validated."],
      riskNotes: ["No real cost was incurred."],
      typoAndStyleNotes: [],
      requiredRevisions: ["Run Hermes manually to produce a real QA review."],
      optionalSuggestions: ["Review payload before running the paid Hermes call."],
      publishReadiness: "needs_revision",
      qaScore: 0,
      finalRecommendation: "revise",
      reason: "dry-run result only.",
      referenceBundle: data.referenceBundle,
      blogImagePrompts: data.blogImagePrompts,
      parseStatus: "json",
      durationMs: 0,
    },
  };
}

async function hermesQaExecution(data: ContentPipelineInput, planner: PlannerExecution, marketing: MarketingExecution, writer: WriterExecution): Promise<QaExecution> {
  if (planner.agentRunStatus === "failed") {
    const outputSummary = "qa-auditor Hermes run was skipped because content-planner failed.";
    return {
      status: "failed",
      taskStatus: "오류",
      progress: 0,
      currentStep: "content-planner failure detected",
      outputTitle: `${data.title} · QA run skipped`,
      outputSummary,
      recentOutput: outputSummary,
      agentRunMode: "hermes-skipped",
      agentRunStatus: "failed",
      agentRunError: outputSummary,
      result: {
        ok: false,
        provider: "hermes-bridge",
        agentId: "qa-auditor",
        errorCode: "QA_SKIPPED_AFTER_PLANNER_FAILURE",
        errorMessage: outputSummary,
      },
    };
  }

  if (marketing.agentRunStatus === "failed") {
    const outputSummary = "qa-auditor Hermes run was skipped because marketing-manager failed.";
    return {
      status: "failed",
      taskStatus: "오류",
      progress: 0,
      currentStep: "marketing-manager failure detected",
      outputTitle: `${data.title} · QA run skipped`,
      outputSummary,
      recentOutput: outputSummary,
      agentRunMode: "hermes-skipped",
      agentRunStatus: "failed",
      agentRunError: outputSummary,
      result: {
        ok: false,
        provider: "hermes-bridge",
        agentId: "qa-auditor",
        errorCode: "QA_SKIPPED_AFTER_MARKETING_FAILURE",
        errorMessage: outputSummary,
      },
    };
  }

  if (writer.agentRunStatus === "failed") {
    const outputSummary = "qa-auditor Hermes run was skipped because content-writer failed.";
    return {
      status: "failed",
      taskStatus: "오류",
      progress: 0,
      currentStep: "content-writer failure detected",
      outputTitle: `${data.title} · QA run skipped`,
      outputSummary,
      recentOutput: outputSummary,
      agentRunMode: "hermes-skipped",
      agentRunStatus: "failed",
      agentRunError: outputSummary,
      result: {
        ok: false,
        provider: "hermes-bridge",
        agentId: "qa-auditor",
        errorCode: "QA_SKIPPED_AFTER_WRITER_FAILURE",
        errorMessage: outputSummary,
      },
    };
  }

  const { payload, result } = await runQaAuditHermes({
    topic: data.topic,
    title: data.title,
    channel: data.channel,
    language: "ko",
    ...hermesStockContext(data, "qa-auditor"),
    plannerResult: planner.result,
    marketingResult: marketing.result,
    writerResult: writer.result,
    referenceBundle: data.referenceBundle,
    blogImagePrompts: data.blogImagePrompts,
  });
  const hermesPayload = toJsonObject(payload);
  const normalizedResult = normalizeResultForMetadata(result as NormalizedPipelineResult);

  if (!result.ok) {
    const outputTitle = `${data.title} · QA Hermes run failed`;
    const outputSummary = result.errorMessage ?? "Hermes qa-auditor run failed.";
    return {
      status: "failed",
      taskStatus: "오류",
      progress: 30,
      currentStep: "QA Hermes run failed",
      outputTitle,
      outputSummary,
      recentOutput: outputSummary,
      agentRunMode: "hermes",
      agentRunStatus: "failed",
      agentRunError: outputSummary,
      hermesPayload,
      hermesResponse: normalizedResult,
      result: normalizedResult,
    };
  }

  const outputTitle = `${data.title} · QA review draft`;
  const outputSummary = result.qaSummary ?? result.reason ?? "Hermes qa-auditor returned a QA review result.";
  return {
    status: "succeeded",
    taskStatus: "완료",
    progress: 100,
    currentStep: "Hermes QA review completed",
    outputTitle,
    outputSummary,
    recentOutput: outputSummary,
    agentRunMode: "hermes",
    agentRunStatus: "succeeded",
    agentRunSummary: outputSummary,
    hermesJobId: result.hermesJobId,
    hermesPayload,
    hermesResponse: normalizedResult,
    result: normalizedResult,
  };
}

async function executeQa(data: ContentPipelineInput, planner: PlannerExecution, marketing: MarketingExecution, writer: WriterExecution): Promise<QaExecution> {
  const runnerMode = data.runnerMode ?? "mock";
  if (runnerMode === "hermes-dry-run") return dryRunQaExecution(data, planner, marketing, writer);
  if (runnerMode === "hermes") return hermesQaExecution(data, planner, marketing, writer);
  return mockQaExecution(data, planner, marketing, writer);
}

function runFromEvent(event: {
  id: string;
  timestamp: Date;
  payload: Prisma.JsonValue | Prisma.InputJsonValue;
}): ContentPipelineRun | null {
  if (!event.payload || typeof event.payload !== "object" || Array.isArray(event.payload)) return null;
  const payload = event.payload as Record<string, unknown>;
  const pipelineId = typeof payload.contentPipelineId === "string" ? payload.contentPipelineId : event.id;
  const taskIds = Array.isArray(payload.taskIds) ? payload.taskIds.filter((id): id is string => typeof id === "string") : [];
  const plannerResult = asRecord(payload.plannerResult);
  const marketingResult = asRecord(payload.marketingResult);
  const writerResult = asRecord(payload.writerResult);
  const qaResult = asRecord(payload.qaResult);
  const referenceBundle = asReferenceBundle(payload.referenceBundle);
  const blogImagePrompts = asBlogImagePrompts(payload.blogImagePrompts);
  const contentImages = Array.isArray(payload.contentImages)
    ? payload.contentImages as unknown as StockBlogContentImage[]
    : undefined;
  const imageQuality = payload.imageQuality && typeof payload.imageQuality === "object" && !Array.isArray(payload.imageQuality)
    ? payload.imageQuality as unknown as StockBlogImageQualityAudit
    : undefined;
  const qualityGate = asRecord(payload.qualityGate) as ContentPipelineRun["qualityGate"] | undefined;
  const editorialBenchmark = asRecord(payload.editorialBenchmark) as unknown as StockBlogEditorialBenchmark | undefined;
  const qualityBlocked = qualityGate?.ok === false;
  return {
    id: pipelineId,
    title: typeof payload.title === "string" ? payload.title : "콘텐츠 파이프라인",
    topic: typeof payload.topic === "string" ? payload.topic : "주제 미정",
    channel: channels.has(String(payload.channel)) ? payload.channel as ContentChannel : "blog",
    status: plannerResult?.ok === false ? "planning" : marketingResult?.ok === false ? "marketing_review" : writerResult?.ok === false ? "content_writing" : qaResult?.ok === false || qualityBlocked ? "qa_review" : "director_approval",
    currentStep: plannerResult?.ok === false ? "content-planner 확인 필요" : marketingResult?.ok === false ? "marketing-manager 확인 필요" : writerResult?.ok === false ? "content-writer 확인 필요" : qaResult?.ok === false ? "qa-auditor 확인 필요" : qualityBlocked ? "실참조/품질 게이트 확인 필요" : "Director 승인 대기",
    taskIds,
    approvalId: typeof payload.approvalId === "string" ? payload.approvalId : undefined,
    outputTitle: typeof payload.outputTitle === "string" ? payload.outputTitle : undefined,
    outputSummary: typeof payload.outputSummary === "string" ? payload.outputSummary : undefined,
    runnerMode: typeof payload.runnerMode === "string" ? payload.runnerMode as ContentPipelineRun["runnerMode"] : "mock",
    plannerResult: plannerResult ? {
      ok: plannerResult.ok !== false,
      provider: typeof plannerResult.provider === "string" ? plannerResult.provider : "mock",
      agentId: typeof plannerResult.agentId === "string" ? plannerResult.agentId : "content-planner",
      title: typeof plannerResult.title === "string" ? plannerResult.title : undefined,
      summary: typeof plannerResult.summary === "string" ? plannerResult.summary : undefined,
      content: typeof plannerResult.content === "string" ? plannerResult.content : undefined,
      draftDirection: typeof plannerResult.draftDirection === "string" ? plannerResult.draftDirection : undefined,
      outline: asStringArray(plannerResult.outline),
      seoKeywords: asStringArray(plannerResult.seoKeywords),
      targetAudience: typeof plannerResult.targetAudience === "string" ? plannerResult.targetAudience : undefined,
      tone: typeof plannerResult.tone === "string" ? plannerResult.tone : undefined,
      thumbnailIdea: typeof plannerResult.thumbnailIdea === "string" ? plannerResult.thumbnailIdea : undefined,
      cta: typeof plannerResult.cta === "string" ? plannerResult.cta : undefined,
      parseStatus: asParseStatus(plannerResult.parseStatus),
      rawText: typeof plannerResult.rawText === "string" ? plannerResult.rawText : undefined,
      durationMs: asNumber(plannerResult.durationMs),
      telemetry: asHermesRunTelemetry(plannerResult.telemetry),
      errorCode: typeof plannerResult.errorCode === "string" ? plannerResult.errorCode : undefined,
      errorMessage: typeof plannerResult.errorMessage === "string" ? plannerResult.errorMessage : undefined,
    } : undefined,
    marketingResult: marketingResult ? {
      ok: marketingResult.ok !== false,
      provider: typeof marketingResult.provider === "string" ? marketingResult.provider : "mock",
      agentId: typeof marketingResult.agentId === "string" ? marketingResult.agentId : "marketing-manager",
      reviewSummary: typeof marketingResult.reviewSummary === "string" ? marketingResult.reviewSummary : undefined,
      titleSuggestions: asStringArray(marketingResult.titleSuggestions),
      recommendedTitle: typeof marketingResult.recommendedTitle === "string" ? marketingResult.recommendedTitle : undefined,
      thumbnailCopy: typeof marketingResult.thumbnailCopy === "string" ? marketingResult.thumbnailCopy : undefined,
      seoKeywords: asStringArray(marketingResult.seoKeywords),
      introHook: typeof marketingResult.introHook === "string" ? marketingResult.introHook : undefined,
      promotionCopy: asRecord(marketingResult.promotionCopy) as { short?: string; long?: string } | undefined,
      clickPoints: asStringArray(marketingResult.clickPoints),
      riskNotes: asStringArray(marketingResult.riskNotes),
      improvementSuggestions: asStringArray(marketingResult.improvementSuggestions),
      marketingScore: asNumber(marketingResult.marketingScore),
      finalRecommendation: marketingResult.finalRecommendation === "approve" || marketingResult.finalRecommendation === "revise" ? marketingResult.finalRecommendation : undefined,
      reason: typeof marketingResult.reason === "string" ? marketingResult.reason : undefined,
      referenceBundle: asReferenceBundle(marketingResult.referenceBundle) ?? referenceBundle,
      blogImagePrompts: asBlogImagePrompts(marketingResult.blogImagePrompts) ?? blogImagePrompts,
      parseStatus: asParseStatus(marketingResult.parseStatus),
      rawText: typeof marketingResult.rawText === "string" ? marketingResult.rawText : undefined,
      durationMs: asNumber(marketingResult.durationMs),
      telemetry: asHermesRunTelemetry(marketingResult.telemetry),
      errorCode: typeof marketingResult.errorCode === "string" ? marketingResult.errorCode : undefined,
      errorMessage: typeof marketingResult.errorMessage === "string" ? marketingResult.errorMessage : undefined,
    } : undefined,
    writerResult: writerResult ? {
      ok: writerResult.ok !== false,
      provider: typeof writerResult.provider === "string" ? writerResult.provider : "mock",
      agentId: typeof writerResult.agentId === "string" ? writerResult.agentId : "content-writer",
      finalTitle: typeof writerResult.finalTitle === "string" ? writerResult.finalTitle : undefined,
      metaDescription: typeof writerResult.metaDescription === "string" ? writerResult.metaDescription : undefined,
      introduction: typeof writerResult.introduction === "string" ? writerResult.introduction : undefined,
      sections: asWriterSections(writerResult.sections),
      conclusion: typeof writerResult.conclusion === "string" ? writerResult.conclusion : undefined,
      cta: typeof writerResult.cta === "string" ? writerResult.cta : undefined,
      fullDraft: typeof writerResult.fullDraft === "string" ? writerResult.fullDraft : undefined,
      markdownDraft: typeof writerResult.markdownDraft === "string" ? writerResult.markdownDraft : undefined,
      htmlDraft: typeof writerResult.htmlDraft === "string" ? writerResult.htmlDraft : undefined,
      usedSeoKeywords: asStringArray(writerResult.usedSeoKeywords),
      writingNotes: asStringArray(writerResult.writingNotes),
      verifiedSchedule: asVerifiedSchedule(writerResult.verifiedSchedule),
      scheduleValidation: asScheduleValidation(writerResult.scheduleValidation),
      referenceBundle: asReferenceBundle(writerResult.referenceBundle) ?? referenceBundle,
      blogImagePrompts: asBlogImagePrompts(writerResult.blogImagePrompts) ?? blogImagePrompts,
      parseStatus: asParseStatus(writerResult.parseStatus),
      rawText: typeof writerResult.rawText === "string" ? writerResult.rawText : undefined,
      durationMs: asNumber(writerResult.durationMs),
      telemetry: asHermesRunTelemetry(writerResult.telemetry),
      errorCode: typeof writerResult.errorCode === "string" ? writerResult.errorCode : undefined,
      errorMessage: typeof writerResult.errorMessage === "string" ? writerResult.errorMessage : undefined,
    } : undefined,
    qaResult: qaResult ? {
      ok: qaResult.ok !== false,
      provider: typeof qaResult.provider === "string" ? qaResult.provider : "mock",
      agentId: typeof qaResult.agentId === "string" ? qaResult.agentId : "qa-auditor",
      qaSummary: typeof qaResult.qaSummary === "string" ? qaResult.qaSummary : undefined,
      factCheckNotes: asStringArray(qaResult.factCheckNotes),
      qualityNotes: asStringArray(qaResult.qualityNotes),
      riskNotes: asStringArray(qaResult.riskNotes),
      typoAndStyleNotes: asStringArray(qaResult.typoAndStyleNotes),
      requiredRevisions: asStringArray(qaResult.requiredRevisions),
      optionalSuggestions: asStringArray(qaResult.optionalSuggestions),
      publishReadiness: qaResult.publishReadiness === "ready" || qaResult.publishReadiness === "needs_revision" || qaResult.publishReadiness === "blocked" ? qaResult.publishReadiness : undefined,
      qaScore: asNumber(qaResult.qaScore),
      finalRecommendation: qaResult.finalRecommendation === "approve" || qaResult.finalRecommendation === "revise" || qaResult.finalRecommendation === "block" ? qaResult.finalRecommendation : undefined,
      reason: typeof qaResult.reason === "string" ? qaResult.reason : undefined,
      referenceBundle: asReferenceBundle(qaResult.referenceBundle) ?? referenceBundle,
      blogImagePrompts: asBlogImagePrompts(qaResult.blogImagePrompts) ?? blogImagePrompts,
      parseStatus: asParseStatus(qaResult.parseStatus),
      rawText: typeof qaResult.rawText === "string" ? qaResult.rawText : undefined,
      durationMs: asNumber(qaResult.durationMs),
      telemetry: asHermesRunTelemetry(qaResult.telemetry),
      errorCode: typeof qaResult.errorCode === "string" ? qaResult.errorCode : undefined,
      errorMessage: typeof qaResult.errorMessage === "string" ? qaResult.errorMessage : undefined,
    } : undefined,
    referenceBundle,
    blogImagePrompts,
    qualityGate,
    editorialBenchmark,
    thumbnailImageUrl: typeof payload.thumbnailImageUrl === "string" ? payload.thumbnailImageUrl : undefined,
    inlineImageUrls: asStringArray(payload.inlineImageUrls),
    contentImages,
    imageQuality,
    imageStatus: payload.imageStatus === "generated" || payload.imageStatus === "failed" ? payload.imageStatus : undefined,
    imageGeneratedAt: typeof payload.imageGeneratedAt === "string" ? payload.imageGeneratedAt : undefined,
    imageErrorMessage: typeof payload.imageErrorMessage === "string" ? payload.imageErrorMessage : undefined,
    hermesRequestPayload: asRecord(payload.hermesRequestPayload),
    hermesMarketingRequestPayload: asRecord(payload.hermesMarketingRequestPayload),
    hermesWriterRequestPayload: asRecord(payload.hermesWriterRequestPayload),
    hermesQaRequestPayload: asRecord(payload.hermesQaRequestPayload),
    createdAt: event.timestamp.toISOString(),
    updatedAt: event.timestamp.toISOString(),
  };
}

export async function listContentPipelines(): Promise<ContentPipelineRun[]> {
  const events = await prisma.eventLog.findMany({
    where: { type: "ContentPipelineStarted" },
    orderBy: { timestamp: "desc" },
    take: 20,
  });
  const runs = events.map(runFromEvent).filter((run): run is ContentPipelineRun => Boolean(run));
  const approvalIds = runs.map((run) => run.approvalId).filter((id): id is string => Boolean(id));
  const approvals = await prisma.approvalRequest.findMany({ where: { id: { in: approvalIds } } });
  const approvalsById = new Map(approvals.map((approval) => [approval.id, approval]));
  return runs.map((run) => {
    const approval = run.approvalId ? approvalsById.get(run.approvalId) : undefined;
    if (!approval) return run;
    if (approval.status === "승인 완료") return { ...run, status: "approved", currentStep: "승인 완료 · 게시 준비", updatedAt: approval.updatedAt.toISOString() };
    if (approval.status === "반려") return { ...run, status: "rejected", currentStep: "반려 · 수정 필요", updatedAt: approval.updatedAt.toISOString() };
    if (approval.status === "수정 요청") return { ...run, status: "revision_requested", currentStep: "수정 요청", updatedAt: approval.updatedAt.toISOString() };
    if (run.plannerResult?.ok === false) return { ...run, status: "planning", currentStep: "content-planner 확인 필요", updatedAt: approval.updatedAt.toISOString() };
    if (run.marketingResult?.ok === false) return { ...run, status: "marketing_review", currentStep: "marketing-manager 확인 필요", updatedAt: approval.updatedAt.toISOString() };
    if (run.writerResult?.ok === false) return { ...run, status: "content_writing", currentStep: "content-writer 확인 필요", updatedAt: approval.updatedAt.toISOString() };
    if (run.qaResult?.ok === false) return { ...run, status: "qa_review", currentStep: "qa-auditor 확인 필요", updatedAt: approval.updatedAt.toISOString() };
    if (run.qualityGate?.ok === false) return { ...run, status: "qa_review", currentStep: "실참조/품질 게이트 확인 필요", updatedAt: approval.updatedAt.toISOString() };
    return run;
  });
}

function pipelineStatusFromApproval(status?: string | null): { status: ContentPipelineStatus; currentStep: string } {
  if (status === "승인 완료") return { status: "approved", currentStep: "승인 완료 · 게시 준비" };
  if (status === "반려") return { status: "rejected", currentStep: "반려 · 수정 필요" };
  if (status === "수정 요청") return { status: "revision_requested", currentStep: "수정 요청" };
  if (status === "보류") return { status: "director_approval", currentStep: "승인 보류" };
  return { status: "director_approval", currentStep: "Director 승인 대기" };
}

function pipelineIdFromPayload(payload: Prisma.JsonValue, fallback: string) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return fallback;
  const value = (payload as Record<string, unknown>).contentPipelineId;
  return typeof value === "string" ? value : fallback;
}

function dedupeTimelineRows<T extends { id: string; eventId: string | null; title: string; description: string | null; timestamp: Date }>(rows: T[]) {
  const seen = new Set<string>();
  return rows.filter((row) => {
    const key = row.eventId
      ? `event:${row.eventId}`
      : `timeline:${row.title}:${row.description ?? ""}:${row.timestamp.toISOString()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function getContentPipelineDetail(pipelineId: string): Promise<ContentPipelineDetail | null> {
  const startedEvents = await prisma.eventLog.findMany({
    where: { type: "ContentPipelineStarted" },
    orderBy: { timestamp: "desc" },
    take: 100,
  });
  const event = startedEvents.find((candidate) => pipelineIdFromPayload(candidate.payload, candidate.id) === pipelineId);
  if (!event) return null;

  const baseRun = runFromEvent(event);
  if (!baseRun) return null;

  const tasks = baseRun.taskIds.length > 0
    ? await prisma.task.findMany({ where: { id: { in: baseRun.taskIds } } })
    : [];
  const agentRuns = baseRun.taskIds.length > 0
    ? await prisma.agentRun.findMany({ where: { taskId: { in: baseRun.taskIds } }, orderBy: { createdAt: "asc" } })
    : [];
  const approval = baseRun.approvalId
    ? await prisma.approvalRequest.findUnique({ where: { id: baseRun.approvalId } })
    : null;
  const timelineTargets = [
    ...baseRun.taskIds.map((taskId) => ({ targetType: "task", targetId: taskId })),
    baseRun.approvalId ? { targetType: "approval", targetId: baseRun.approvalId } : null,
  ].filter((target): target is { targetType: string; targetId: string } => Boolean(target));
  const timeline = timelineTargets.length > 0
    ? await prisma.timeline.findMany({
      where: { OR: timelineTargets },
      include: { event: true },
      orderBy: { timestamp: "desc" },
      take: 50,
    })
    : [];
  const dedupedTimeline = dedupeTimelineRows(timeline);
  const status = baseRun.plannerResult?.ok === false
    ? { status: "planning" as ContentPipelineStatus, currentStep: "content-planner 확인 필요" }
    : baseRun.marketingResult?.ok === false
      ? { status: "marketing_review" as ContentPipelineStatus, currentStep: "marketing-manager 확인 필요" }
      : baseRun.writerResult?.ok === false
        ? { status: "content_writing" as ContentPipelineStatus, currentStep: "content-writer 확인 필요" }
        : baseRun.qaResult?.ok === false
          ? { status: "qa_review" as ContentPipelineStatus, currentStep: "qa-auditor 확인 필요" }
          : pipelineStatusFromApproval(approval?.status);
  const pipeline: ContentPipelineRun = {
    ...baseRun,
    status: status.status,
    currentStep: status.currentStep,
    updatedAt: approval?.updatedAt.toISOString() ?? baseRun.updatedAt,
  };

  return {
    pipeline,
    tasks: tasks
      .map(serializeTask)
      .map((task) => ({
        id: task.id,
        title: task.title,
        status: task.status,
        progress: task.progress,
        assignedEmployeeId: task.assignedEmployeeId,
        currentStep: task.currentStep,
        recentOutput: task.recentOutput,
      })),
    approval: approval ? (() => {
      const item = serializeApproval(approval);
      return {
        id: item.id,
        title: item.title,
        status: item.status,
        requestedByEmployeeId: item.requestedByEmployeeId,
        taskId: item.taskId,
        reason: item.reason ?? "",
        decision: item.decision,
        decisionReason: item.decisionReason,
      };
    })() : null,
    agentRuns: agentRuns.map((run) => ({
      id: run.id,
      taskId: run.taskId,
      employeeId: run.employeeId,
      mode: run.mode,
      status: run.status,
      resultSummary: run.resultSummary,
      errorMessage: run.errorMessage,
      hermesJobId: run.hermesJobId,
      metadata: asRecord(run.metadata),
      createdAt: run.createdAt.toISOString(),
      updatedAt: run.updatedAt.toISOString(),
    })),
    timeline: dedupedTimeline.map((item) => {
      const serialized = serializeTimeline(item);
      return {
        ...serialized,
        timestamp: serialized.timestamp.toISOString(),
        event: item.event ? {
          ...item.event,
          timestamp: item.event.timestamp.toISOString(),
          payload: typeof item.event.payload === "object" && item.event.payload !== null && !Array.isArray(item.event.payload)
            ? item.event.payload as Record<string, unknown>
            : {},
        } : null,
      };
    }),
  };
}

export async function regenerateContentPipelineImages(pipelineId: string) {
  const startedEvents = await prisma.eventLog.findMany({
    where: { type: "ContentPipelineStarted" },
    orderBy: { timestamp: "desc" },
    take: 100,
  });
  const event = startedEvents.find((candidate) => pipelineIdFromPayload(candidate.payload, candidate.id) === pipelineId);
  if (!event) throw new Error("CONTENT_PIPELINE_NOT_FOUND");
  const pipeline = runFromEvent(event);
  if (!pipeline) throw new Error("CONTENT_PIPELINE_PAYLOAD_INVALID");
  const bundle = pipeline.referenceBundle;
  if (!bundle?.marketSnapshot) throw new Error("MARKET_SNAPSHOT_REQUIRED_FOR_IMAGES");
  const generatedImages = await generateStockBlogImages({
    pipelineId,
    template: bundle.contentType,
    title: pipeline.writerResult?.finalTitle ?? pipeline.outputTitle ?? pipeline.title,
    topic: pipeline.topic,
    marketDate: bundle.marketDate,
    marketSnapshot: bundle.marketSnapshot,
    referenceBundle: bundle,
  });
  const payload = event.payload && typeof event.payload === "object" && !Array.isArray(event.payload)
    ? event.payload as Record<string, unknown>
    : {};
  await prisma.eventLog.update({
    where: { id: event.id },
    data: {
      payload: toJsonObject({
        ...payload,
        thumbnailImageUrl: generatedImages.thumbnailImageUrl,
        inlineImageUrls: generatedImages.inlineImageUrls,
        contentImages: generatedImages.contentImages,
        imageQuality: generatedImages.imageQuality,
        imageStatus: generatedImages.imageStatus,
        imageGeneratedAt: generatedImages.imageGeneratedAt,
        imageErrorMessage: generatedImages.imageErrorMessage,
      }),
    },
  });
  await createEvent({
    type: "ContentPipelineImagesRegenerated",
    payload: {
      contentPipelineId: pipelineId,
      imageStatus: generatedImages.imageStatus,
      imageQualityStatus: generatedImages.imageQuality.status,
      bodyImageCount: generatedImages.imageQuality.bodyImageCount,
      chartImageCount: generatedImages.imageQuality.chartImageCount,
      issueCodes: generatedImages.imageQuality.issues.map((issue) => issue.code),
    },
    summary: generatedImages.imageQuality.status === "passed"
      ? "검증된 MarketSnapshot 기반 본문 차트 재생성 완료"
      : "본문 이미지 품질 검사 차단",
  });
  return generatedImages;
}

export async function startContentPipeline(input: unknown): Promise<ContentPipelineRun> {
  const baseData = assertValidInput(input);
  const runnerMode = baseData.runnerMode ?? "mock";
  const data = await enrichContentPipelineInput(baseData);
  const preflightQualityGate = evaluateStockBlogReferences(data.referenceBundle, runnerMode === "hermes");
  if (runnerMode === "hermes" && !preflightQualityGate.ok) {
    const error = new Error(`STOCK_REFERENCE_PREFLIGHT_BLOCKED: ${preflightQualityGate.status} · ${preflightQualityGate.reasons.join(" / ")}`);
    Object.assign(error, { code: "STOCK_REFERENCE_PREFLIGHT_BLOCKED", qualityGate: preflightQualityGate });
    await createEvent({
      type: "ErrorOccurred",
      employeeId: "stock-monitor",
      payload: {
        errorCode: "STOCK_REFERENCE_PREFLIGHT_BLOCKED",
        message: error.message,
        area: "stock-blog",
        stage: "reference-preflight",
        contentType: data.referenceBundle?.contentType,
        marketDate: data.referenceBundle?.marketDate,
        ...(data.operationalRunKey ? { scheduleKey: data.operationalRunKey } : {}),
        ...(data.operationalAttempt ? { attempt: data.operationalAttempt } : {}),
        qualityGate: preflightQualityGate,
        status: "blocked",
      },
      summary: `${data.title} Reference preflight 안전 정지`,
    });
    throw error;
  }
  if (runnerMode === "hermes") await assertHermesDailyRunAvailable(HERMES_PIPELINE_REQUIRED_RUNS);

  const pipelineId = `content-pipeline-${randomUUID()}`;
  const suffix = pipelineId.replace("content-pipeline-", "").slice(0, 8);
  const now = new Date();
  const contentTaskId = `task-content-${suffix}`;
  const marketingTaskId = `task-marketing-${suffix}`;
  const writerTaskId = `task-writer-${suffix}`;
  const qaTaskId = `task-qa-${suffix}`;
  const approvalId = `approval-content-${suffix}`;
  const taskIds = [contentTaskId, marketingTaskId, writerTaskId, qaTaskId];
  const planner = await executePlanner(data);
  const marketing = await executeMarketing(data, planner);
  let rawWriter = await executeWriter(data, planner, marketing);
  let scheduleCheckedWriter = runnerMode === "hermes"
    ? withVerifiedSchedule(rawWriter, data.referenceBundle)
    : rawWriter;
  let writer = withMarketDataDisclosure(scheduleCheckedWriter, data.referenceBundle);
  let qa = await executeQa(data, planner, marketing, writer);
  const writerQaAttempts: WriterQaAttempt[] = [{ attempt: 1, writer, qa }];

  while (
    runnerMode === "hermes"
    && writer.agentRunStatus === "succeeded"
    && qa.agentRunStatus === "succeeded"
    && shouldRetryStockBlogQa(qa.result, writerQaAttempts.length, writer.result, data.referenceBundle?.contentType)
  ) {
    const revisionAttempt = writerQaAttempts.length + 1;
    rawWriter = await executeWriter(data, planner, marketing, {
      revisionAttempt,
      previousWriterResult: writer.result,
      qaRevisionFeedback: buildStockBlogQaRevisionFeedback(qa.result, writer.result, data.referenceBundle?.contentType),
    });
    scheduleCheckedWriter = withVerifiedSchedule(rawWriter, data.referenceBundle);
    writer = withMarketDataDisclosure(scheduleCheckedWriter, data.referenceBundle);
    qa = await executeQa(data, planner, marketing, writer);
    writerQaAttempts.push({ attempt: revisionAttempt, writer, qa });
  }

  const latestSuccessfulWriterQaAttempt = selectLatestSuccessfulWriterQaAttempt(writerQaAttempts);
  if (latestSuccessfulWriterQaAttempt) {
    writer = latestSuccessfulWriterQaAttempt.writer;
    qa = latestSuccessfulWriterQaAttempt.qa;
  }

  const revisionHistory = writerQaAttempts.map((item) => ({
    attempt: item.attempt,
    writerStatus: item.writer.agentRunStatus,
    qaStatus: item.qa.agentRunStatus,
    qaScore: typeof item.qa.result.qaScore === "number" ? item.qa.result.qaScore : null,
    publishReadiness: typeof item.qa.result.publishReadiness === "string" ? item.qa.result.publishReadiness : null,
    finalRecommendation: typeof item.qa.result.finalRecommendation === "string" ? item.qa.result.finalRecommendation : null,
    requiredRevisions: Array.isArray(item.qa.result.requiredRevisions)
      ? item.qa.result.requiredRevisions.filter((value): value is string => typeof value === "string")
      : [],
  }));
  const outputTitle = writer.agentRunStatus === "succeeded" && typeof writer.result.finalTitle === "string" ? writer.result.finalTitle : planner.outputTitle;
  const outputSummary = qa.agentRunStatus === "succeeded"
    ? qa.outputSummary
    : writer.agentRunStatus === "succeeded"
      ? writer.outputSummary
      : marketing.agentRunStatus === "succeeded"
        ? marketing.outputSummary
        : planner.outputSummary;
  const generatedImages = await generateStockBlogImages({
    pipelineId,
    template: data.referenceBundle?.contentType ?? inferReferenceTemplate(data),
    title: outputTitle,
    topic: data.topic,
    marketDate: data.referenceBundle?.marketDate,
    marketSnapshot: data.referenceBundle?.marketSnapshot,
    referenceBundle: data.referenceBundle,
  });
  const metadataInput = {
    pipelineId,
    topic: data.topic,
    channel: data.channel,
    title: data.title,
    runnerMode,
    taskIds,
    approvalId,
    outputTitle,
    outputSummary,
    plannerResult: planner.result,
    marketingResult: marketing.result,
    writerResult: writer.result,
    qaResult: qa.result,
    hermesRequestPayload: planner.hermesPayload,
    hermesMarketingRequestPayload: marketing.hermesPayload,
    hermesWriterRequestPayload: writer.hermesPayload,
    hermesQaRequestPayload: qa.hermesPayload,
    referenceBundle: data.referenceBundle,
    blogImagePrompts: data.blogImagePrompts,
    generatedImages,
    revisionHistory,
  };
  const provisionalMetadata = pipelineMetadata(metadataInput);
  const provisionalPipeline = runFromEvent({ id: pipelineId, timestamp: now, payload: provisionalMetadata });
  if (!provisionalPipeline) throw new Error("CONTENT_PIPELINE_METADATA_INVALID");
  const bundle = data.referenceBundle;
  const realReferences = getRealStockReferences(bundle);
  const publisherCount = new Set(realReferences.map((item) => item.publisher?.trim()).filter(Boolean)).size;
  const snapshot = bundle?.marketSnapshot;
  const editorialBenchmark = buildStockBlogEditorialBenchmark({
    generatedAt: now.toISOString(),
    contentType: bundle?.contentType,
    title: provisionalPipeline.writerResult?.finalTitle ?? outputTitle,
    body: provisionalPipeline.writerResult?.fullDraft ?? "",
    imageCount: generatedImages.contentImages.length,
    realReferenceCount: realReferences.length,
    publisherCount,
    verifiedMarketSnapshot: snapshot?.status === "ready"
      && snapshot.dataQuality === "verified"
      && snapshot.freshness?.status === "fresh",
    qaScore: provisionalPipeline.qaResult?.qaScore,
    competitorAnalysis: bundle?.competitorAnalysis,
    appliedGuidelines: data.editorialBenchmarkGuidelines,
  });
  const qualityGate = runnerMode === "hermes"
    ? evaluateStockBlogPublishQuality({
      pipeline: { ...provisionalPipeline, editorialBenchmark },
      requireRealReferences: true,
    })
    : preflightQualityGate;
  const qualityBlocked = runnerMode === "hermes" && !qualityGate.ok;
  const metadata = pipelineMetadata({
    ...metadataInput,
    qualityGate,
    editorialBenchmark,
  });

  await prisma.task.createMany({
    data: [
      {
        id: contentTaskId,
        title: `[콘텐츠 기획] ${data.title}`,
        description: `${data.topic} 주제의 ${channelLabel(data.channel)} 콘텐츠 제목/개요/초안 방향을 작성합니다.`,
        department: "콘텐츠팀",
        assignedEmployeeId: "content-planner",
        status: planner.taskStatus,
        progress: planner.progress,
        startedAt: now,
        completedAt: planner.agentRunStatus === "succeeded" ? now : null,
        model: runnerMode === "mock" ? "Mock Agent" : "Hermes Agent",
        cost: "0.0000",
        currentStep: planner.currentStep,
        recentOutput: planner.recentOutput,
        nextAction: planner.agentRunStatus === "failed" ? "Hermes 설정/응답 확인" : "마케팅 문구 검토",
        error: planner.agentRunError ?? null,
      },
      {
        id: marketingTaskId,
        title: `[마케팅 검토] ${data.title}`,
        description: `${data.topic} 콘텐츠의 제목, 썸네일, 홍보 문구를 검토합니다.`,
        department: "콘텐츠팀",
        assignedEmployeeId: "marketing-manager",
        status: marketing.taskStatus,
        progress: marketing.progress,
        startedAt: now,
        completedAt: marketing.agentRunStatus === "succeeded" ? now : null,
        model: marketing.agentRunMode === "mock" ? "Mock Agent" : marketing.agentRunMode === "hermes-dry-run" ? "Hermes Dry Run" : "Hermes Agent",
        cost: "0.0000",
        currentStep: marketing.currentStep,
        recentOutput: marketing.recentOutput,
        nextAction: marketing.agentRunStatus === "failed" ? "Marketing Hermes 설정/응답 확인" : "본문 초안 작성",
        error: marketing.agentRunError ?? null,
      },
      {
        id: writerTaskId,
        title: `[본문 작성] ${data.title}`,
        description: `${data.topic} 콘텐츠의 게시용 본문 초안을 작성합니다.`,
        department: "콘텐츠팀",
        assignedEmployeeId: "content-writer",
        status: writer.taskStatus,
        progress: writer.progress,
        startedAt: now,
        completedAt: writer.agentRunStatus === "succeeded" ? now : null,
        model: writer.agentRunMode === "mock" ? "Mock Agent" : writer.agentRunMode === "hermes-dry-run" ? "Hermes Dry Run" : "Hermes Agent",
        cost: "0.0000",
        currentStep: writer.currentStep,
        recentOutput: writer.recentOutput,
        nextAction: writer.agentRunStatus === "failed" ? "Content writer Hermes 설정/응답 확인" : "QA 검토",
        error: writer.agentRunError ?? null,
      },
      {
        id: qaTaskId,
        title: `[QA 검토] ${data.title}`,
        description: `${data.topic} 콘텐츠 초안의 사실성, 정책, 품질 기준을 검토합니다.`,
        department: "지식·감사",
        assignedEmployeeId: "qa-auditor",
        status: qa.taskStatus,
        progress: qa.progress,
        startedAt: now,
        completedAt: qa.agentRunStatus === "succeeded" ? now : null,
        model: qa.agentRunMode === "mock" ? "Mock Agent" : qa.agentRunMode === "hermes-dry-run" ? "Hermes Dry Run" : "Hermes Agent",
        cost: "0.0000",
        currentStep: qa.currentStep,
        recentOutput: qa.recentOutput,
        nextAction: qa.agentRunStatus === "failed" ? "QA Hermes 설정/응답 확인" : "Director 승인",
        error: qa.agentRunError ?? null,
      },
    ],
  });

  const hasFailedAgent = planner.agentRunStatus === "failed" || marketing.agentRunStatus === "failed" || writer.agentRunStatus === "failed" || qa.agentRunStatus === "failed" || qualityBlocked;

  await prisma.approvalRequest.create({
    data: {
      id: approvalId,
      title: `[콘텐츠 최종 승인] ${data.title}`,
      requestedByEmployeeId: "director",
      taskId: qaTaskId,
      approvalType: "콘텐츠",
      riskLevel: hasFailedAgent ? "높음" : "보통",
      estimatedCost: "0.0000",
      status: "승인 대기",
      reason: `${data.topic} 콘텐츠를 ${channelLabel(data.channel)} 채널에 게시하기 전 대표 최종 승인이 필요합니다.`,
      plannedAction: qualityBlocked ? `실참조/품질 게이트 실패를 해결합니다: ${qualityGate.reasons.join(" / ")}` : hasFailedAgent ? "Hermes 실패 사유를 확인한 뒤 재실행 또는 mock 결과로 검토합니다." : "승인 후 게시 준비 상태로 전환합니다.",
      expectedResult: "콘텐츠 결과물이 게시 준비 상태가 됩니다.",
    },
  });

  await createPipelineAgentRun({
    pipelineId,
    taskId: contentTaskId,
    employeeId: "content-planner",
    mode: runnerMode,
    status: planner.agentRunStatus,
    summary: planner.agentRunSummary,
    errorMessage: planner.agentRunError,
    hermesJobId: planner.hermesJobId,
    metadata: { role: "content-planner", hermesPayload: planner.hermesPayload, hermesResponse: planner.hermesResponse, plannerResult: planner.result },
  });
  await createPipelineAgentRun({
    pipelineId,
    taskId: marketingTaskId,
    employeeId: "marketing-manager",
    mode: marketing.agentRunMode,
    status: marketing.agentRunStatus,
    summary: marketing.agentRunSummary,
    errorMessage: marketing.agentRunError,
    hermesJobId: marketing.hermesJobId,
    metadata: { role: "marketing-manager", hermesPayload: marketing.hermesPayload, hermesResponse: marketing.hermesResponse, plannerResult: planner.result, marketingResult: marketing.result },
  });
  for (const item of writerQaAttempts) {
    await createPipelineAgentRun({
      pipelineId,
      taskId: writerTaskId,
      employeeId: "content-writer",
      mode: item.writer.agentRunMode,
      status: item.writer.agentRunStatus,
      summary: item.writer.agentRunSummary,
      errorMessage: item.writer.agentRunError,
      hermesJobId: item.writer.hermesJobId,
      metadata: {
        role: "content-writer",
        revisionAttempt: item.attempt,
        maxQaAttempts: STOCK_BLOG_MAX_QA_ATTEMPTS,
        hermesPayload: item.writer.hermesPayload,
        hermesResponse: item.writer.hermesResponse,
        plannerResult: planner.result,
        marketingResult: marketing.result,
        writerResult: item.writer.result,
      },
    });
    await createPipelineAgentRun({
      pipelineId,
      taskId: qaTaskId,
      employeeId: "qa-auditor",
      mode: item.qa.agentRunMode,
      status: item.qa.agentRunStatus,
      summary: item.qa.agentRunSummary,
      errorMessage: item.qa.agentRunError,
      hermesJobId: item.qa.hermesJobId,
      metadata: {
        role: "qa-auditor",
        revisionAttempt: item.attempt,
        maxQaAttempts: STOCK_BLOG_MAX_QA_ATTEMPTS,
        hermesPayload: item.qa.hermesPayload,
        hermesResponse: item.qa.hermesResponse,
        plannerResult: planner.result,
        marketingResult: marketing.result,
        writerResult: item.writer.result,
        qaResult: item.qa.result,
      },
    });
  }

  await createEvent({ type: "ContentPipelineStarted", payload: metadata, summary: `${data.title} 콘텐츠 파이프라인 시작` });
  await createEvent({
    type: "StockBlogBenchmarkRecorded",
    employeeId: "qa-auditor",
    taskId: qaTaskId,
    payload: {
      contentPipelineId: pipelineId,
      contentType: data.referenceBundle?.contentType,
      benchmark: editorialBenchmark,
      qualityGate,
    },
    summary: `${data.title} 경쟁 블로그 비교 완료 · 편집 품질 ${editorialBenchmark.quality.score}/100`,
  });
  for (const item of revisionHistory.slice(1)) {
    await createEvent({
      type: "ContentPipelineQaRevisionCompleted",
      employeeId: "qa-auditor",
      taskId: qaTaskId,
      payload: {
        contentPipelineId: pipelineId,
        attempt: item.attempt,
        maxAttempts: STOCK_BLOG_MAX_QA_ATTEMPTS,
        qaScore: item.qaScore,
        publishReadiness: item.publishReadiness,
        finalRecommendation: item.finalRecommendation,
        requiredRevisions: item.requiredRevisions,
      },
      summary: `QA 피드백 반영 재작성·재검수 ${item.attempt}/${STOCK_BLOG_MAX_QA_ATTEMPTS} 완료`,
    });
  }
  await createEvent({ type: "TaskStarted", employeeId: "content-planner", taskId: contentTaskId, payload: { ...metadata, title: data.title }, summary: "콘텐츠 기획 시작" });
  if (planner.agentRunStatus === "failed") {
    await createEvent({ type: "ErrorOccurred", employeeId: "content-planner", taskId: contentTaskId, payload: { ...metadata, error: planner.agentRunError, message: planner.agentRunError, errorCode: executionErrorCode(planner), area: "stock-blog", stage: "content-planning", status: "오류 대응 중" }, summary: `content-planner Hermes 실행 실패 · ${planner.agentRunError ?? "원인 미상"}` });
  } else {
    await createEvent({ type: "OutputGenerated", employeeId: "content-planner", taskId: contentTaskId, payload: { ...metadata, outputTitle: planner.outputTitle, output: planner.outputTitle, status: "업무 완료" }, summary: "콘텐츠 기획 초안 생성" });
  }
  await createEvent({ type: "TaskStarted", employeeId: "marketing-manager", taskId: marketingTaskId, payload: { ...metadata, title: data.title }, summary: "마케팅 검토 시작" });
  if (marketing.agentRunStatus === "failed") {
    await createEvent({ type: "ErrorOccurred", employeeId: "marketing-manager", taskId: marketingTaskId, payload: { ...metadata, error: marketing.agentRunError, message: marketing.agentRunError, errorCode: executionErrorCode(marketing), area: "stock-blog", stage: "marketing-review", status: "오류 대응 중" }, summary: `marketing-manager Hermes 실행 실패 · ${marketing.agentRunError ?? "원인 미상"}` });
  } else {
    await createEvent({ type: "OutputGenerated", employeeId: "marketing-manager", taskId: marketingTaskId, payload: { ...metadata, outputTitle: marketing.outputTitle, output: marketing.outputSummary, status: "업무 완료" }, summary: "마케팅 검토 완료" });
  }
  await createEvent({ type: "TaskStarted", employeeId: "content-writer", taskId: writerTaskId, payload: { ...metadata, title: data.title }, summary: "본문 초안 작성 시작" });
  if (writer.agentRunStatus === "failed") {
    await createEvent({ type: "ErrorOccurred", employeeId: "content-writer", taskId: writerTaskId, payload: { ...metadata, error: writer.agentRunError, message: writer.agentRunError, errorCode: executionErrorCode(writer), area: "stock-blog", stage: "content-writing", status: "오류 대응 중" }, summary: `content-writer Hermes 실행 실패 · ${writer.agentRunError ?? "원인 미상"}` });
  } else {
    await createEvent({ type: "OutputGenerated", employeeId: "content-writer", taskId: writerTaskId, payload: { ...metadata, outputTitle: writer.outputTitle, output: writer.outputSummary, status: "업무 완료" }, summary: "본문 초안 작성 완료" });
  }
  await createEvent({ type: "TaskStarted", employeeId: "qa-auditor", taskId: qaTaskId, payload: { ...metadata, title: data.title }, summary: "QA 검토 시작" });
  if (qa.agentRunStatus === "failed") {
    await createEvent({ type: "ErrorOccurred", employeeId: "qa-auditor", taskId: qaTaskId, payload: { ...metadata, error: qa.agentRunError, message: qa.agentRunError, errorCode: executionErrorCode(qa), area: "stock-blog", stage: "qa-review", status: "오류 대응 중" }, summary: `qa-auditor Hermes 실행 실패 · ${qa.agentRunError ?? "원인 미상"}` });
  } else {
    await createEvent({ type: "OutputGenerated", employeeId: "qa-auditor", taskId: qaTaskId, payload: { ...metadata, outputTitle: qa.outputTitle, output: qa.outputSummary, status: "검토 중" }, summary: "QA 검토 결과 생성" });
  }
  if (qualityBlocked) {
    await createEvent({
      type: "ErrorOccurred",
      employeeId: "qa-auditor",
      taskId: qaTaskId,
      payload: {
        ...metadata,
        errorCode: "STOCK_CONTENT_QUALITY_FAILED",
        message: `품질 게이트 차단: ${qualityGate.reasons.join(" / ")}`,
        area: "stock-blog",
        stage: "quality-gate",
        status: "blocked",
      },
      summary: `${data.title} 게시 품질 게이트 차단`,
    });
  }
  await createEvent({ type: "ApprovalRequested", employeeId: "director", taskId: qaTaskId, approvalId, payload: { ...metadata, title: `[콘텐츠 최종 승인] ${data.title}`, status: "승인 대기" }, summary: "Director 콘텐츠 최종 승인 요청" });

  const status = planner.agentRunStatus === "failed" ? "planning" : marketing.agentRunStatus === "failed" ? "marketing_review" : writer.agentRunStatus === "failed" ? "content_writing" : qa.agentRunStatus === "failed" || qualityBlocked ? "qa_review" : "director_approval";
  const currentStep = planner.agentRunStatus === "failed" ? "content-planner 확인 필요" : marketing.agentRunStatus === "failed" ? "marketing-manager 확인 필요" : writer.agentRunStatus === "failed" ? "content-writer 확인 필요" : qa.agentRunStatus === "failed" ? "qa-auditor 확인 필요" : qualityBlocked ? "실참조/품질 게이트 확인 필요" : "Director 승인 대기";

  return {
    id: pipelineId,
    title: data.title,
    topic: data.topic,
    channel: data.channel,
    status,
    currentStep,
    taskIds,
    approvalId,
    outputTitle,
    outputSummary,
    runnerMode,
    plannerResult: runFromEvent({ id: pipelineId, timestamp: now, payload: metadata })?.plannerResult,
    marketingResult: runFromEvent({ id: pipelineId, timestamp: now, payload: metadata })?.marketingResult,
    writerResult: runFromEvent({ id: pipelineId, timestamp: now, payload: metadata })?.writerResult,
    qaResult: runFromEvent({ id: pipelineId, timestamp: now, payload: metadata })?.qaResult,
    hermesRequestPayload: planner.hermesPayload,
    hermesMarketingRequestPayload: marketing.hermesPayload,
    hermesWriterRequestPayload: writer.hermesPayload,
    hermesQaRequestPayload: qa.hermesPayload,
    referenceBundle: data.referenceBundle,
    blogImagePrompts: data.blogImagePrompts,
    thumbnailImageUrl: generatedImages.thumbnailImageUrl,
    inlineImageUrls: generatedImages.inlineImageUrls,
    contentImages: generatedImages.contentImages,
    imageQuality: generatedImages.imageQuality,
    imageStatus: generatedImages.imageStatus,
    imageGeneratedAt: generatedImages.imageGeneratedAt,
    imageErrorMessage: generatedImages.imageErrorMessage,
    qualityGate,
    editorialBenchmark,
    createdAt: now.toISOString(),
    updatedAt: new Date().toISOString(),
  };
}
