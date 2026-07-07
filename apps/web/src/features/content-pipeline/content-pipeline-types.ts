import type { TimelineRecord } from "@/features/timelines/api";

export type ContentChannel = "blog" | "instagram" | "youtube" | "newsletter";
export type ContentPipelineStatus =
  | "draft_requested"
  | "planning"
  | "marketing_review"
  | "content_writing"
  | "qa_review"
  | "director_approval"
  | "approved"
  | "rejected"
  | "revision_requested"
  | "published_ready"
  | "completed";

export type ContentPlannerParseStatus = "json" | "json_extracted" | "fallback_text";

export type ContentPlannerResult = {
  ok: boolean;
  provider: string;
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
  parseStatus?: ContentPlannerParseStatus;
  rawText?: string;
  durationMs?: number;
  errorCode?: string;
  errorMessage?: string;
};

export type MarketingReviewResult = {
  ok: boolean;
  provider: string;
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
  parseStatus?: ContentPlannerParseStatus;
  rawText?: string;
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
  provider: string;
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
  parseStatus?: ContentPlannerParseStatus;
  rawText?: string;
  durationMs?: number;
  errorCode?: string;
  errorMessage?: string;
};

export type QaAuditResult = {
  ok: boolean;
  provider: string;
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
  parseStatus?: ContentPlannerParseStatus;
  rawText?: string;
  durationMs?: number;
  errorCode?: string;
  errorMessage?: string;
};

export type StockBriefingTemplate =
  | "KOREA_DAILY_PREVIEW"
  | "KOREA_MARKET_CLOSE_US_PREVIEW"
  | "WEEKLY_MARKET_REVIEW"
  | "NEXT_WEEK_MARKET_PREVIEW";

export type StockBriefingTemplateConfig = {
  type: StockBriefingTemplate;
  label: string;
  recommendedSchedule: string;
  recommendedCategory: string;
  requiredSections: string[];
  defaultTags: string[];
  thumbnailTextCandidates: string[];
};

export type NaverBlogPublishPrepImageIdea = {
  position: string;
  description: string;
  prompt: string;
};

export type NaverBlogPublishPrep = {
  naverTitle: string;
  naverCategory: string;
  naverTags: string[];
  thumbnailText: string;
  thumbnailPrompt: string;
  inlineImageIdeas: NaverBlogPublishPrepImageIdea[];
  intro: string;
  marketSummary: string;
  indexAndSectorFlow: string;
  keyPoints: string[];
  investorChecklist: string[];
  closingComment: string;
  pasteReadyBody: string;
  markdownBody: string;
  htmlBody: string;
  disclaimer: string;
  checklist: Array<{ label: string; checked: boolean }>;
  publishStatus: "ready_to_copy" | "copied" | "manually_published";
  externalUrl?: string;
  briefingTemplate?: StockBriefingTemplate;
  briefingTemplateLabel?: string;
  recommendedSchedule?: string;
};

export type ContentPipelineRun = {
  id: string;
  title: string;
  topic: string;
  channel: ContentChannel;
  status: ContentPipelineStatus;
  currentStep: string;
  taskIds: string[];
  approvalId?: string;
  outputTitle?: string;
  outputSummary?: string;
  runnerMode?: "mock" | "hermes-dry-run" | "hermes";
  plannerResult?: ContentPlannerResult;
  marketingResult?: MarketingReviewResult;
  writerResult?: ContentWriterResult;
  qaResult?: QaAuditResult;
  naverBlogPublishPrep?: NaverBlogPublishPrep;
  hermesRequestPayload?: Record<string, unknown>;
  hermesMarketingRequestPayload?: Record<string, unknown>;
  hermesWriterRequestPayload?: Record<string, unknown>;
  hermesQaRequestPayload?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type ContentPipelineTask = {
  id: string;
  title: string;
  status: string;
  progress: number;
  assignedEmployeeId: string | null;
  currentStep: string | null;
  recentOutput: string | null;
};

export type ContentPipelineApproval = {
  id: string;
  title: string;
  status: string;
  requestedByEmployeeId: string;
  taskId: string | null;
  reason: string;
  decision: string | null;
  decisionReason: string | null;
};

export type ContentPipelineAgentRun = {
  id: string;
  taskId: string | null;
  employeeId: string;
  mode: string;
  status: string;
  resultSummary: string | null;
  errorMessage: string | null;
  hermesJobId: string | null;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type ContentPipelineDetail = {
  pipeline: ContentPipelineRun;
  tasks: ContentPipelineTask[];
  approval: ContentPipelineApproval | null;
  agentRuns: ContentPipelineAgentRun[];
  timeline: TimelineRecord[];
};

export type ContentPipelineRequest = {
  topic: string;
  channel: ContentChannel;
  title: string;
  runnerMode?: "mock" | "hermes-dry-run" | "hermes";
};

export type ContentPipelineResponse = {
  ok: true;
  pipeline: ContentPipelineRun;
};


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
