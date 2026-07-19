import type { BlogImagePrompt, CompetitorBlogAnalysisSummary, CompetitorBlogReference, MarketSnapshot, ReferenceBundle, ReferenceItem, StockReferenceBriefingTemplate } from "@/lib/stock-blog/references/reference-types";
import type { VerifiedSchedule, VerifiedScheduleValidation } from "@/lib/stock-blog/verified-schedule";

export type ContentPlannerHermesInput = {
  topic: string;
  title: string;
  channel: string;
  language?: "ko" | "en";
  contentType?: StockReferenceBriefingTemplate;
  marketDate?: string;
  marketSnapshot?: MarketSnapshot;
  referenceBundle?: ReferenceBundle;
  competitorBlogReferences?: CompetitorBlogReference[];
  referencePolicy?: string[];
  prohibitedPhrases?: string[];
};

export type MarketingReviewHermesInput = ContentPlannerHermesInput & {
  plannerResult?: Record<string, unknown>;
};

export type ContentWriterHermesInput = ContentPlannerHermesInput & {
  plannerResult?: Record<string, unknown>;
  marketingResult?: Record<string, unknown>;
  referenceBundle?: ReferenceBundle;
  blogImagePrompts?: BlogImagePrompt[];
};

export type QaAuditHermesInput = ContentPlannerHermesInput & {
  plannerResult?: Record<string, unknown>;
  marketingResult?: Record<string, unknown>;
  writerResult?: Record<string, unknown>;
  referenceBundle?: ReferenceBundle;
  blogImagePrompts?: BlogImagePrompt[];
};

export type HermesContentPlannerPayload = {
  agentId: "content-planner";
  role: "content_planner";
  taskType: "content_planning";
  input: {
    topic: string;
    title: string;
    channel: string;
    language: "ko" | "en";
    contentType?: StockReferenceBriefingTemplate;
    marketDate?: string;
    marketSnapshot?: MarketSnapshot;
    referenceBundle?: ReferenceBundle;
    competitorBlogReferences?: CompetitorBlogReference[];
    referencePolicy?: string[];
    prohibitedPhrases?: string[];
  };
  context: {
    company: "BG Company";
    workflow: "content_pipeline";
    runnerMode: "hermes";
  };
};

export type HermesMarketingReviewPayload = {
  agentId: "marketing-manager";
  role: "marketing_reviewer";
  taskType: "marketing_review";
  input: {
    topic: string;
    title: string;
    channel: string;
    language: "ko" | "en";
    plannerResult?: Record<string, unknown>;
    competitorBlogReferences?: CompetitorBlogReference[];
    competitorAnalysis?: CompetitorBlogAnalysisSummary;
    searchKeywords?: string[];
    differentiationPoints?: string[];
    prohibitedPhrases?: string[];
  };
  context: {
    company: "BG Company";
    workflow: "content_pipeline";
    runnerMode: "hermes";
    dependsOn: "content-planner";
  };
};

export type HermesContentWriterPayload = {
  agentId: "content-writer";
  role: "content_writer";
  taskType: "content_writing";
  input: {
    topic: string;
    title: string;
    channel: string;
    language: "ko" | "en";
    plannerResult?: Record<string, unknown>;
    marketingResult?: Record<string, unknown>;
    referenceBundle?: ReferenceBundle;
    realReferences?: ReferenceItem[];
    marketSnapshot?: MarketSnapshot;
    competitorBlogReferences?: CompetitorBlogReference[];
    bodyStructure?: string[];
    prohibitedPhrases?: string[];
    blogImagePrompts?: BlogImagePrompt[];
    referencePolicy?: string[];
  };
  context: {
    company: "BG Company";
    workflow: "content_pipeline";
    runnerMode: "hermes";
    dependsOn: ["content-planner", "marketing-manager"];
  };
};

export type HermesQaAuditPayload = {
  agentId: "qa-auditor";
  role: "qa_auditor";
  taskType: "qa_review";
  input: {
    topic: string;
    title: string;
    channel: string;
    language: "ko" | "en";
    plannerResult?: Record<string, unknown>;
    marketingResult?: Record<string, unknown>;
    writerResult?: Record<string, unknown>;
    referenceBundle?: ReferenceBundle;
    realReferences?: ReferenceItem[];
    marketSnapshot?: MarketSnapshot;
    qualityGateDiagnostics?: Record<string, unknown>;
    finalPasteReadyBody?: string;
    prohibitedPhrases?: string[];
    blogImagePrompts?: BlogImagePrompt[];
    referencePolicy?: string[];
  };
  context: {
    company: "BG Company";
    workflow: "content_pipeline";
    runnerMode: "hermes";
    dependsOn: ["content-planner", "marketing-manager", "content-writer"];
  };
};

export type HermesParseStatus = "json" | "json_extracted" | "fallback_text";

export type HermesRunTelemetry = {
  agentId: string;
  model: string;
  durationMs: number;
  promptBytes: number;
  outputBytes: number;
  exitCode?: number;
  timeoutLimitMs: number;
  memoryUsagePercentAtStart?: number;
};

export type NormalizedHermesRunResult = {
  ok: boolean;
  provider: "hermes" | "hermes-bridge";
  agentId: string;
  title?: string;
  summary?: string;
  content?: string;
  draftDirection?: string;
  outline?: string[];
  seoKeywords?: string[];
  targetAudience?: string;
  tone?: string;
  thumbnailIdea?: string;
  cta?: string;
  parseStatus?: HermesParseStatus;
  rawText?: string;
  raw?: unknown;
  hermesJobId?: string;
  durationMs?: number;
  telemetry?: HermesRunTelemetry;
  errorCode?: string;
  errorMessage?: string;
};

export type MarketingReviewResult = {
  ok: boolean;
  provider: "hermes" | "hermes-bridge";
  agentId: string;
  reviewSummary?: string;
  titleSuggestions?: string[];
  recommendedTitle?: string;
  thumbnailCopy?: string;
  seoKeywords?: string[];
  introHook?: string;
  promotionCopy?: { short?: string; long?: string };
  clickPoints?: string[];
  riskNotes?: string[];
  improvementSuggestions?: string[];
  marketingScore?: number;
  finalRecommendation?: "approve" | "revise";
  reason?: string;
  referenceBundle?: ReferenceBundle;
  blogImagePrompts?: BlogImagePrompt[];
  parseStatus?: HermesParseStatus;
  rawText?: string;
  raw?: unknown;
  hermesJobId?: string;
  durationMs?: number;
  telemetry?: HermesRunTelemetry;
  errorCode?: string;
  errorMessage?: string;
};


export type ContentWriterSection = {
  heading?: string;
  body?: string;
};

export type ContentWriterResult = {
  ok: boolean;
  provider: "hermes" | "hermes-bridge";
  agentId: string;
  finalTitle?: string;
  metaDescription?: string;
  introduction?: string;
  sections?: ContentWriterSection[];
  conclusion?: string;
  cta?: string;
  fullDraft?: string;
  markdownDraft?: string;
  htmlDraft?: string;
  usedSeoKeywords?: string[];
  writingNotes?: string[];
  verifiedSchedule?: VerifiedSchedule;
  scheduleValidation?: VerifiedScheduleValidation;
  referenceBundle?: ReferenceBundle;
  blogImagePrompts?: BlogImagePrompt[];
  parseStatus?: HermesParseStatus;
  rawText?: string;
  raw?: unknown;
  hermesJobId?: string;
  durationMs?: number;
  telemetry?: HermesRunTelemetry;
  errorCode?: string;
  errorMessage?: string;
};

export type QaAuditResult = {
  ok: boolean;
  provider: "hermes" | "hermes-bridge";
  agentId: string;
  qaSummary?: string;
  factCheckNotes?: string[];
  qualityNotes?: string[];
  riskNotes?: string[];
  typoAndStyleNotes?: string[];
  requiredRevisions?: string[];
  optionalSuggestions?: string[];
  publishReadiness?: "ready" | "needs_revision" | "blocked";
  qaScore?: number;
  finalRecommendation?: "approve" | "revise" | "block";
  reason?: string;
  referenceBundle?: ReferenceBundle;
  blogImagePrompts?: BlogImagePrompt[];
  parseStatus?: HermesParseStatus;
  rawText?: string;
  raw?: unknown;
  hermesJobId?: string;
  durationMs?: number;
  telemetry?: HermesRunTelemetry;
  errorCode?: string;
  errorMessage?: string;
};
