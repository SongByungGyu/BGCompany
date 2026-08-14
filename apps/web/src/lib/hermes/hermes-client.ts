import { getHermesConfig } from "@/lib/agents/hermes-client";
import type {
  ContentPlannerHermesInput,
  ContentWriterHermesInput,
  ContentWriterResult,
  HermesContentPlannerPayload,
  HermesContentWriterPayload,
  HermesMarketingReviewPayload,
  HermesQaAuditPayload,
  HermesRunTelemetry,
  MarketingReviewHermesInput,
  MarketingReviewResult,
  QaAuditHermesInput,
  QaAuditResult,
  NormalizedHermesRunResult,
} from "./hermes-types";
import { getRealStockReferences } from "@/lib/stock-blog/quality-gate";
import { FRED_DEGRADED_DISCLOSURE } from "@/lib/stock-blog/references/fred-degraded-policy";
import {
  BG_MARKET_NOTE_EDITORIAL_POLICY_VERSION,
  getStockBlogEditorialPolicy,
} from "@/lib/stock-blog/stock-blog-editorial-policy";
import { STOCK_BLOG_EDITORIAL_QUALITY_TARGET } from "@/lib/stock-blog/stock-blog-editorial-benchmark";

function baseUrl(url: string) {
  return url.replace(/\/$/, "");
}

type StockBlogHermesAgentId = "content-planner" | "marketing-manager" | "content-writer" | "qa-auditor";

function positiveNumber(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function getAgentProcessTimeoutMs(agentId: string) {
  const legacyTimeoutMs = positiveNumber(process.env.HERMES_BRIDGE_TIMEOUT_MS ?? process.env.HERMES_TIMEOUT_MS, 60000);
  const timeouts: Record<StockBlogHermesAgentId, number> = {
    "content-planner": positiveNumber(process.env.HERMES_PLANNER_TIMEOUT_MS, Math.max(legacyTimeoutMs, 60000)),
    "marketing-manager": positiveNumber(process.env.HERMES_MARKETING_TIMEOUT_MS, Math.max(legacyTimeoutMs, 60000)),
    "content-writer": positiveNumber(process.env.HERMES_WRITER_TIMEOUT_MS, Math.max(legacyTimeoutMs, 120000)),
    "qa-auditor": positiveNumber(process.env.HERMES_QA_TIMEOUT_MS, Math.max(legacyTimeoutMs, 90000)),
  };
  return timeouts[agentId as StockBlogHermesAgentId] ?? legacyTimeoutMs;
}

function getHermesBridgeConfig(agentId: string = "content-planner") {
  const processTimeoutMs = getAgentProcessTimeoutMs(agentId);
  const clientTimeoutBufferMs = positiveNumber(process.env.HERMES_CLIENT_TIMEOUT_BUFFER_MS, 15000);
  return {
    baseUrl: process.env.HERMES_BRIDGE_BASE_URL?.trim() || "http://hermes-bridge:8787",
    apiKey: process.env.BRIDGE_API_KEY?.trim() || process.env.HERMES_BRIDGE_API_KEY?.trim() || "",
    processTimeoutMs,
    clientTimeoutBufferMs,
    timeoutMs: processTimeoutMs + clientTimeoutBufferMs,
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function pickRecord(raw: unknown) {
  const record = asRecord(raw);
  if (!record) return null;
  const result = asRecord(record.result);
  if (result) return result;
  const output = asRecord(record.output);
  if (output) return output;
  const data = asRecord(record.data);
  if (data) return data;
  return record;
}

function pickString(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return undefined;
}

function pickNumber(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim()) {
      const parsed = Number.parseFloat(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return undefined;
}

function pickTelemetry(record: Record<string, unknown>): HermesRunTelemetry | undefined {
  const telemetry = asRecord(record.telemetry) ?? asRecord(record.raw);
  if (!telemetry) return undefined;
  const agentId = typeof telemetry.agentId === "string" ? telemetry.agentId : undefined;
  const model = typeof telemetry.model === "string" ? telemetry.model : undefined;
  const durationMs = typeof telemetry.durationMs === "number" ? telemetry.durationMs : undefined;
  const promptBytes = typeof telemetry.promptBytes === "number" ? telemetry.promptBytes : undefined;
  const outputBytes = typeof telemetry.outputBytes === "number" ? telemetry.outputBytes : undefined;
  const timeoutLimitMs = typeof telemetry.timeoutLimitMs === "number" ? telemetry.timeoutLimitMs : undefined;
  if (!agentId || !model || durationMs === undefined || promptBytes === undefined || outputBytes === undefined || timeoutLimitMs === undefined) return undefined;
  return {
    agentId,
    model,
    durationMs,
    promptBytes,
    outputBytes,
    exitCode: typeof telemetry.exitCode === "number" ? telemetry.exitCode : undefined,
    timeoutLimitMs,
    memoryUsagePercentAtStart: typeof telemetry.memoryUsagePercentAtStart === "number" ? telemetry.memoryUsagePercentAtStart : undefined,
  };
}

function pickOutline(record: Record<string, unknown>) {
  const outline = record.outline ?? record.sections ?? record.headings;
  if (!Array.isArray(outline)) return undefined;
  const values = outline
    .map((item) => typeof item === "string" ? item : asRecord(item)?.title)
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0);
  return values.length > 0 ? values : undefined;
}

function pickStringArray(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (Array.isArray(value)) {
      const values = value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
      if (values.length > 0) return values;
    }
    if (typeof value === "string" && value.trim()) {
      const values = value.split(/[,\n]/).map((item) => item.trim()).filter(Boolean);
      if (values.length > 0) return values;
    }
  }
  return undefined;
}

type PickedWriterSection = { heading?: string; body?: string };

function pickWriterSections(record: Record<string, unknown>): PickedWriterSection[] | undefined {
  const value = record.sections ?? record.bodySections ?? record.articleSections;
  if (!Array.isArray(value)) return undefined;
  const sections = value
    .map((item): PickedWriterSection | null => {
      if (typeof item === "string" && item.trim()) return { body: item.trim() };
      const section = asRecord(item);
      if (!section) return null;
      const heading = pickString(section, ["heading", "title", "sectionTitle"]);
      const body = pickString(section, ["body", "content", "text", "paragraph"]);
      return heading || body ? { heading, body } : null;
    })
    .filter((item): item is PickedWriterSection => Boolean(item));
  return sections.length > 0 ? sections : undefined;
}

function pickPromotionCopy(record: Record<string, unknown>) {
  const value = asRecord(record.promotionCopy);
  if (!value) return undefined;
  const short = typeof value.short === "string" && value.short.trim() ? value.short : undefined;
  const long = typeof value.long === "string" && value.long.trim() ? value.long : undefined;
  return short || long ? { short, long } : undefined;
}

function pickRecommendation(record: Record<string, unknown>) {
  const value = record.finalRecommendation;
  return value === "approve" || value === "revise" ? value : undefined;
}

function pickQaRecommendation(record: Record<string, unknown>) {
  const value = record.finalRecommendation;
  return value === "approve" || value === "revise" || value === "block" ? value : undefined;
}

function pickPublishReadiness(record: Record<string, unknown>) {
  const value = record.publishReadiness;
  return value === "ready" || value === "needs_revision" || value === "blocked" ? value : undefined;
}

function pickParseStatus(record: Record<string, unknown>) {
  const value = record.parseStatus;
  return value === "json" || value === "json_extracted" || value === "fallback_text" ? value : undefined;
}

const STOCK_REFERENCE_POLICY = [
  "Use only the provided referenceBundle as factual grounding for market/index/sector claims.",
  "Do not invent index levels, percentages, dates, company events, or source names that are not present in referenceBundle.",
  "Rewrite in original wording; never copy article sentences or full paragraphs verbatim.",
  "If referenceBundle is missing, insufficient, mock, or real-disabled, explicitly return a blocked/needs_reference result instead of guessing.",
  "If marketSnapshot.degradedMode is fred_unavailable, omit unavailable U.S. Treasury yield and economic-calendar values and never infer replacements.",
  `When marketSnapshot.degradedMode is fred_unavailable, include this exact disclosure in the final body: ${FRED_DEGRADED_DISCLOSURE}`,
  "Avoid buy/sell recommendations, guaranteed returns, sensational claims, or unsupported forecasts.",
];

function extractHermesJobId(raw: unknown) {
  const record = asRecord(raw);
  if (!record) return undefined;
  for (const key of ["hermesJobId", "jobId", "id", "runId"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return undefined;
}

function extractErrorMessage(raw: unknown) {
  const record = asRecord(raw);
  if (!record) return undefined;
  const message = record.message ?? record.error ?? record.errorMessage;
  return typeof message === "string" ? message : undefined;
}

async function readResponseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { text };
  }
}

export function buildContentPlannerHermesPayload(input: ContentPlannerHermesInput): HermesContentPlannerPayload {
  return {
    agentId: "content-planner",
    role: "content_planner",
    taskType: "content_planning",
    input: {
      topic: input.topic,
      title: input.title,
      channel: input.channel,
      language: input.language ?? "ko",
      contentType: input.contentType,
      marketDate: input.marketDate,
      marketSnapshot: input.marketSnapshot,
      referenceBundle: input.referenceBundle,
      competitorBlogReferences: input.competitorBlogReferences,
      editorialBenchmarkGuidelines: input.editorialBenchmarkGuidelines,
      referencePolicy: input.referencePolicy ?? STOCK_REFERENCE_POLICY,
      prohibitedPhrases: input.prohibitedPhrases,
      approvedLessons: input.approvedLessons,
    },
    context: {
      company: "BG Company",
      workflow: "content_pipeline",
      runnerMode: "hermes",
    },
  };
}

export function buildMarketingReviewHermesPayload(input: MarketingReviewHermesInput): HermesMarketingReviewPayload {
  return {
    agentId: "marketing-manager",
    role: "marketing_reviewer",
    taskType: "marketing_review",
    input: {
      topic: input.topic,
      title: input.title,
      channel: input.channel,
      language: input.language ?? "ko",
      plannerResult: input.plannerResult,
      competitorBlogReferences: input.competitorBlogReferences,
      competitorAnalysis: input.referenceBundle?.competitorAnalysis,
      searchKeywords: input.referenceBundle?.queries,
      differentiationPoints: input.referenceBundle?.differentiationPoints,
      editorialBenchmarkGuidelines: input.editorialBenchmarkGuidelines,
      prohibitedPhrases: input.prohibitedPhrases,
      approvedLessons: input.approvedLessons,
    },
    context: {
      company: "BG Company",
      workflow: "content_pipeline",
      runnerMode: "hermes",
      dependsOn: "content-planner",
    },
  };
}

export function buildContentWriterHermesPayload(input: ContentWriterHermesInput): HermesContentWriterPayload {
  const contentType = input.referenceBundle?.contentType ?? input.contentType ?? "KOREA_DAILY_PREVIEW";
  const editorialPolicy = getStockBlogEditorialPolicy(contentType);
  return {
    agentId: "content-writer",
    role: "content_writer",
    taskType: "content_writing",
    input: {
      topic: input.topic,
      title: input.title,
      channel: input.channel,
      language: input.language ?? "ko",
      plannerResult: input.plannerResult,
      marketingResult: input.marketingResult,
      referenceBundle: input.referenceBundle,
      realReferences: getRealStockReferences(input.referenceBundle),
      marketSnapshot: input.referenceBundle?.marketSnapshot,
      competitorBlogReferences: input.referenceBundle?.competitorBlogReferences,
      editorialBenchmarkGuidelines: input.editorialBenchmarkGuidelines,
      bodyStructure: editorialPolicy.bodyStructure,
      prohibitedPhrases: input.prohibitedPhrases,
      blogImagePrompts: input.blogImagePrompts,
      referencePolicy: STOCK_REFERENCE_POLICY,
      revisionAttempt: input.revisionAttempt,
      previousWriterResult: input.previousWriterResult,
      qaRevisionFeedback: input.qaRevisionFeedback,
      approvedLessons: input.approvedLessons,
    },
    context: {
      company: "BG Company",
      workflow: "content_pipeline",
      runnerMode: "hermes",
      dependsOn: ["content-planner", "marketing-manager"],
    },
  };
}

export function buildQaAuditHermesPayload(input: QaAuditHermesInput): HermesQaAuditPayload {
  return {
    agentId: "qa-auditor",
    role: "qa_auditor",
    taskType: "qa_review",
    input: {
      topic: input.topic,
      title: input.title,
      channel: input.channel,
      language: input.language ?? "ko",
      plannerResult: input.plannerResult,
      marketingResult: input.marketingResult,
      writerResult: input.writerResult,
      referenceBundle: input.referenceBundle,
      realReferences: getRealStockReferences(input.referenceBundle),
      marketSnapshot: input.referenceBundle?.marketSnapshot,
      qualityGateDiagnostics: {
        editorialPolicyVersion: BG_MARKET_NOTE_EDITORIAL_POLICY_VERSION,
        requiredRealReferences: 5,
        requiredDistinctPublishers: 3,
        requiredCompetitorReferences: 3,
        requireVerifiedOrAllowedFredDegradedMarketSnapshot: true,
        requiredFredDegradedDisclosure: FRED_DEGRADED_DISCLOSURE,
        requiredEditorialQualityScore: STOCK_BLOG_EDITORIAL_QUALITY_TARGET,
        requiredThirtySecondSummaryLabels: ["판단", "상방 조건", "하방 조건", "다음 확인"],
        requiredCoreVariableCount: 2,
        requiredChecklistItemCount: 3,
        forbiddenEngagementCta: true,
      },
      editorialBenchmarkGuidelines: input.editorialBenchmarkGuidelines,
      finalPasteReadyBody: typeof input.writerResult?.fullDraft === "string" ? input.writerResult.fullDraft : undefined,
      prohibitedPhrases: input.prohibitedPhrases,
      blogImagePrompts: input.blogImagePrompts,
      referencePolicy: STOCK_REFERENCE_POLICY,
      approvedLessons: input.approvedLessons,
    },
    context: {
      company: "BG Company",
      workflow: "content_pipeline",
      runnerMode: "hermes",
      dependsOn: ["content-planner", "marketing-manager", "content-writer"],
    },
  };
}

export function normalizeHermesRunResponse(raw: unknown, agentId = "content-planner"): NormalizedHermesRunResult {
  const record = pickRecord(raw);
  if (!record) {
    return {
      ok: false,
      provider: "hermes",
      agentId,
      raw,
      errorCode: "HERMES_INVALID_RESPONSE",
      errorMessage: "Hermes response did not contain an object result.",
    };
  }

  return {
    ok: true,
    provider: typeof record.provider === "string" && record.provider === "hermes-bridge" ? "hermes-bridge" : "hermes",
    agentId,
    title: pickString(record, ["title", "outputTitle", "headline"]),
    summary: pickString(record, ["summary", "outputSummary", "description"]),
    content: pickString(record, ["content", "body", "draft", "article"]),
    draftDirection: pickString(record, ["draftDirection", "direction", "strategy"]),
    outline: pickOutline(record),
    seoKeywords: pickStringArray(record, ["seoKeywords", "keywords", "seo"]),
    targetAudience: pickString(record, ["targetAudience", "audience", "reader"]),
    tone: pickString(record, ["tone", "voice", "style"]),
    thumbnailIdea: pickString(record, ["thumbnailIdea", "thumbnail", "visualIdea"]),
    cta: pickString(record, ["cta", "callToAction", "action"]),
    parseStatus: pickParseStatus(record),
    rawText: pickString(record, ["rawText"]),
    hermesJobId: extractHermesJobId(raw),
    durationMs: typeof record.durationMs === "number" ? record.durationMs : undefined,
    telemetry: pickTelemetry(record),
    raw,
  };
}

export function normalizeMarketingReviewHermesResponse(raw: unknown): MarketingReviewResult {
  const record = pickRecord(raw);
  if (!record) {
    return {
      ok: false,
      provider: "hermes",
      agentId: "marketing-manager",
      raw,
      errorCode: "HERMES_INVALID_RESPONSE",
      errorMessage: "Hermes response did not contain an object result.",
    };
  }

  return {
    ok: true,
    provider: typeof record.provider === "string" && record.provider === "hermes-bridge" ? "hermes-bridge" : "hermes",
    agentId: "marketing-manager",
    reviewSummary: pickString(record, ["reviewSummary", "summary", "outputSummary"]),
    titleSuggestions: pickStringArray(record, ["titleSuggestions", "titles", "headlineSuggestions"]),
    recommendedTitle: pickString(record, ["recommendedTitle", "title", "bestTitle"]),
    thumbnailCopy: pickString(record, ["thumbnailCopy", "thumbnail", "thumbnailText"]),
    seoKeywords: pickStringArray(record, ["seoKeywords", "keywords", "seo"]),
    introHook: pickString(record, ["introHook", "hook", "opening"]),
    promotionCopy: pickPromotionCopy(record),
    clickPoints: pickStringArray(record, ["clickPoints", "sellingPoints", "appealPoints"]),
    riskNotes: pickStringArray(record, ["riskNotes", "risks", "risk"]),
    improvementSuggestions: pickStringArray(record, ["improvementSuggestions", "suggestions", "improvements"]),
    marketingScore: pickNumber(record, ["marketingScore", "score"]),
    finalRecommendation: pickRecommendation(record),
    reason: pickString(record, ["reason", "recommendationReason"]),
    parseStatus: pickParseStatus(record),
    rawText: pickString(record, ["rawText"]),
    hermesJobId: extractHermesJobId(raw),
    durationMs: typeof record.durationMs === "number" ? record.durationMs : undefined,
    telemetry: pickTelemetry(record),
    raw,
  };
}

export function normalizeContentWriterHermesResponse(raw: unknown): ContentWriterResult {
  const record = pickRecord(raw);
  if (!record) {
    return {
      ok: false,
      provider: "hermes",
      agentId: "content-writer",
      raw,
      errorCode: "HERMES_INVALID_RESPONSE",
      errorMessage: "Hermes response did not contain an object result.",
    };
  }

  return {
    ok: true,
    provider: typeof record.provider === "string" && record.provider === "hermes-bridge" ? "hermes-bridge" : "hermes",
    agentId: "content-writer",
    finalTitle: pickString(record, ["finalTitle", "title", "headline"]),
    metaDescription: pickString(record, ["metaDescription", "description", "summary"]),
    introduction: pickString(record, ["introduction", "intro", "opening"]),
    sections: pickWriterSections(record),
    conclusion: pickString(record, ["conclusion", "closing"]),
    cta: pickString(record, ["cta", "callToAction"]),
    fullDraft: pickString(record, ["fullDraft", "draft", "content", "article", "body"]),
    markdownDraft: pickString(record, ["markdownDraft", "markdown", "md"]),
    htmlDraft: pickString(record, ["htmlDraft", "html"]),
    usedSeoKeywords: pickStringArray(record, ["usedSeoKeywords", "seoKeywords", "keywords", "seo"]),
    writingNotes: pickStringArray(record, ["writingNotes", "notes", "writerNotes"]),
    parseStatus: pickParseStatus(record),
    rawText: pickString(record, ["rawText"]),
    hermesJobId: extractHermesJobId(raw),
    durationMs: typeof record.durationMs === "number" ? record.durationMs : undefined,
    telemetry: pickTelemetry(record),
    raw,
  };
}

export function normalizeQaAuditHermesResponse(raw: unknown): QaAuditResult {
  const record = pickRecord(raw);
  if (!record) {
    return {
      ok: false,
      provider: "hermes",
      agentId: "qa-auditor",
      raw,
      errorCode: "HERMES_INVALID_RESPONSE",
      errorMessage: "Hermes response did not contain an object result.",
    };
  }

  return {
    ok: true,
    provider: typeof record.provider === "string" && record.provider === "hermes-bridge" ? "hermes-bridge" : "hermes",
    agentId: "qa-auditor",
    qaSummary: pickString(record, ["qaSummary", "summary", "outputSummary"]),
    factCheckNotes: pickStringArray(record, ["factCheckNotes", "factChecks", "facts"]),
    qualityNotes: pickStringArray(record, ["qualityNotes", "quality", "qualityFindings"]),
    riskNotes: pickStringArray(record, ["riskNotes", "risks", "risk"]),
    typoAndStyleNotes: pickStringArray(record, ["typoAndStyleNotes", "styleNotes", "typos"]),
    requiredRevisions: pickStringArray(record, ["requiredRevisions", "revisions", "mustFix"]),
    optionalSuggestions: pickStringArray(record, ["optionalSuggestions", "suggestions", "optionalFixes"]),
    publishReadiness: pickPublishReadiness(record),
    qaScore: pickNumber(record, ["qaScore", "score"]),
    finalRecommendation: pickQaRecommendation(record),
    reason: pickString(record, ["reason", "recommendationReason"]),
    parseStatus: pickParseStatus(record),
    rawText: pickString(record, ["rawText"]),
    hermesJobId: extractHermesJobId(raw),
    durationMs: typeof record.durationMs === "number" ? record.durationMs : undefined,
    telemetry: pickTelemetry(record),
    raw,
  };
}

export function hermesRunConfigStatus() {
  const bridge = getHermesBridgeConfig("content-planner");
  const legacy = getHermesConfig();
  return {
    configured: Boolean(bridge.baseUrl && bridge.apiKey),
    bridgeBaseUrl: Boolean(bridge.baseUrl),
    bridgeApiKey: Boolean(bridge.apiKey),
    timeoutMs: bridge.timeoutMs,
    clientTimeoutBufferMs: bridge.clientTimeoutBufferMs,
    agentTimeoutMs: {
      planner: getAgentProcessTimeoutMs("content-planner"),
      marketing: getAgentProcessTimeoutMs("marketing-manager"),
      writer: getAgentProcessTimeoutMs("content-writer"),
      qa: getAgentProcessTimeoutMs("qa-auditor"),
    },
    legacy: {
      baseUrl: Boolean(legacy.baseUrl),
      apiKey: Boolean(legacy.apiKey),
      runPath: legacy.runPath,
    },
  };
}

type HermesBridgePayload = HermesContentPlannerPayload | HermesMarketingReviewPayload | HermesContentWriterPayload | HermesQaAuditPayload;

async function postHermesBridge<T>(payload: HermesBridgePayload, agentId: string, normalize: (raw: unknown) => T): Promise<{ payload: HermesBridgePayload; result: T }> {
  const config = getHermesBridgeConfig(agentId);
  if (!config.baseUrl || !config.apiKey) {
    return {
      payload,
      result: {
        ok: false,
        provider: "hermes-bridge",
        agentId,
        errorCode: "HERMES_BRIDGE_NOT_CONFIGURED",
        errorMessage: "HERMES_BRIDGE_BASE_URL and BRIDGE_API_KEY are required for runnerMode=hermes.",
      } as T,
    };
  }

  const timeoutMs = config.timeoutMs;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${baseUrl(config.baseUrl)}/run`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "x-bridge-api-key": config.apiKey,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const raw = await readResponseBody(response);
    if (!response.ok) {
      const record = asRecord(raw);
      return {
        payload,
        result: {
          ok: false,
          provider: "hermes-bridge",
          agentId,
          raw,
          telemetry: record ? pickTelemetry(record) : undefined,
          errorCode: typeof record?.errorCode === "string" ? record.errorCode : response.status === 401 ? "HERMES_BRIDGE_UNAUTHORIZED" : "HERMES_BRIDGE_HTTP_ERROR",
          errorMessage: extractErrorMessage(raw) ?? `Hermes bridge request failed with HTTP ${response.status}.`,
        } as T,
      };
    }
    const result = normalize(raw);
    return { payload, result: { ...(result as Record<string, unknown>), provider: "hermes-bridge" } as T };
  } catch (error: unknown) {
    const isTimeout = error instanceof Error && error.name === "AbortError";
    return {
      payload,
      result: {
        ok: false,
        provider: "hermes-bridge",
        agentId,
        errorCode: isTimeout ? "HERMES_BRIDGE_TIMEOUT" : "HERMES_BRIDGE_NETWORK_ERROR",
        errorMessage: isTimeout ? `Hermes bridge client deadline exceeded after ${timeoutMs}ms.` : error instanceof Error ? error.message : "Unknown Hermes bridge request error.",
        raw: isTimeout ? { agentId, clientTimeoutMs: timeoutMs, processTimeoutMs: config.processTimeoutMs } : undefined,
      } as T,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function runContentPlannerHermes(input: ContentPlannerHermesInput): Promise<{
  payload: HermesContentPlannerPayload;
  result: NormalizedHermesRunResult;
}> {
  const payload = buildContentPlannerHermesPayload(input);
  const response = await postHermesBridge(payload, "content-planner", (raw) => normalizeHermesRunResponse(raw, "content-planner"));
  return { payload, result: response.result };
}

export async function runMarketingReviewHermes(input: MarketingReviewHermesInput): Promise<{
  payload: HermesMarketingReviewPayload;
  result: MarketingReviewResult;
}> {
  const payload = buildMarketingReviewHermesPayload(input);
  const response = await postHermesBridge(payload, "marketing-manager", normalizeMarketingReviewHermesResponse);
  return { payload, result: response.result };
}


export async function runContentWriterHermes(input: ContentWriterHermesInput): Promise<{
  payload: HermesContentWriterPayload;
  result: ContentWriterResult;
}> {
  const payload = buildContentWriterHermesPayload(input);
  const response = await postHermesBridge(payload, "content-writer", normalizeContentWriterHermesResponse);
  return { payload, result: response.result };
}

export async function runQaAuditHermes(input: QaAuditHermesInput): Promise<{
  payload: HermesQaAuditPayload;
  result: QaAuditResult;
}> {
  const payload = buildQaAuditHermesPayload(input);
  const response = await postHermesBridge(payload, "qa-auditor", normalizeQaAuditHermesResponse);
  return { payload, result: response.result };
}
