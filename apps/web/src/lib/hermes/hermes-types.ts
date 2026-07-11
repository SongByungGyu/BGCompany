import type { BlogImagePrompt, ReferenceBundle } from "@/lib/stock-blog/references/reference-types";

export type ContentPlannerHermesInput = {
  topic: string;
  title: string;
  channel: string;
  language?: "ko" | "en";
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
  referenceBundle?: ReferenceBundle;
  blogImagePrompts?: BlogImagePrompt[];
  parseStatus?: HermesParseStatus;
  rawText?: string;
  raw?: unknown;
  hermesJobId?: string;
  durationMs?: number;
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
  errorCode?: string;
  errorMessage?: string;
};
