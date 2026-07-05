export type ContentPlannerHermesInput = {
  topic: string;
  title: string;
  channel: string;
  language?: "ko" | "en";
};

export type MarketingReviewHermesInput = ContentPlannerHermesInput & {
  plannerResult?: Record<string, unknown>;
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
  parseStatus?: HermesParseStatus;
  rawText?: string;
  raw?: unknown;
  hermesJobId?: string;
  durationMs?: number;
  errorCode?: string;
  errorMessage?: string;
};
