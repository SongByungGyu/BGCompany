import type { ContentChannel } from "@/features/content-pipeline/content-pipeline-types";
import type { OperationalLessonInstruction } from "@/lib/operational-learning/operational-learning-policy";
import type {
  BlogImagePrompt,
  ReferenceBundle,
  StockReferenceBriefingTemplate,
} from "@/lib/stock-blog/references/reference-types";

export type ContentPipelineInput = {
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

const channels = new Set(["blog", "instagram", "youtube", "newsletter"]);
const stockContentTypes = new Set<StockReferenceBriefingTemplate>([
  "KOREA_DAILY_PREVIEW",
  "KOREA_MARKET_CLOSE_US_PREVIEW",
  "WEEKLY_MARKET_REVIEW",
  "NEXT_WEEK_MARKET_PREVIEW",
  "INVESTMENT_STUDY",
  "LARGE_CAP_DISCLOSURE_EARNINGS",
]);
const referenceProviders = new Set(["mock", "naver-search", "manual", "web"]);
const referenceModes = new Set(["mock", "real-disabled", "real"]);
const referenceMarkets = new Set(["KR", "US", "GLOBAL"]);
const referenceSourceTypes = new Set([
  "news", "blog", "disclosure", "market_data", "calendar", "sector",
  "company", "macro", "manual", "mock",
]);
const requiredReferenceBundleArrays = [
  "queries",
  "keyThemes",
  "repeatedKeywords",
  "differentiationPoints",
  "cautionNotes",
] as const;
const optionalReferenceItemStrings = [
  "url", "originalUrl", "publisher", "sourceName", "publishedAt", "collectedAt", "summary", "query",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function assertTrustedReferenceBundle(value: unknown): ReferenceBundle | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw new Error("trusted referenceBundle must be an object");
  if (!referenceProviders.has(String(value.provider))) throw new Error("trusted referenceBundle provider is invalid");
  if (!referenceModes.has(String(value.mode))) throw new Error("trusted referenceBundle mode is invalid");
  if (!stockContentTypes.has(value.contentType as StockReferenceBriefingTemplate)) throw new Error("trusted referenceBundle contentType is invalid");
  if (typeof value.generatedAt !== "string" || !value.generatedAt.trim()) throw new Error("trusted referenceBundle generatedAt is required");
  if (!referenceMarkets.has(String(value.market))) throw new Error("trusted referenceBundle market is invalid");
  for (const field of requiredReferenceBundleArrays) {
    if (!Array.isArray(value[field]) || value[field].some((item) => typeof item !== "string")) {
      throw new Error(`trusted referenceBundle ${field} must be a string array`);
    }
  }
  if (typeof value.sourcePolicy !== "string" || !value.sourcePolicy.trim()) {
    throw new Error("trusted referenceBundle sourcePolicy is required");
  }
  if (!Array.isArray(value.items)) throw new Error("trusted referenceBundle items must be an array");
  if (value.items.some((item) => (
    !isRecord(item)
    || typeof item.id !== "string" || !item.id.trim()
    || !referenceSourceTypes.has(String(item.sourceType))
    || typeof item.provider !== "string" || !item.provider.trim()
    || typeof item.title !== "string" || !item.title.trim()
    || optionalReferenceItemStrings.some((field) => item[field] !== undefined && typeof item[field] !== "string")
    || (item.keywords !== undefined && (!Array.isArray(item.keywords) || item.keywords.some((entry) => typeof entry !== "string")))
  ))) throw new Error("trusted referenceBundle items are invalid");
  return value as ReferenceBundle;
}

function assertTrustedBlogImagePrompts(value: unknown): BlogImagePrompt[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((item) => (
    !isRecord(item)
    || typeof item.id !== "string" || !item.id.trim()
    || !["thumbnail", "section", "inline"].includes(String(item.purpose))
    || typeof item.placement !== "string"
    || typeof item.title !== "string"
    || typeof item.prompt !== "string"
    || typeof item.negativePrompt !== "string"
    || !Array.isArray(item.notes) || item.notes.some((note) => typeof note !== "string")
    || (item.textOverlay !== undefined && typeof item.textOverlay !== "string")
    || (item.aspectRatio !== undefined && typeof item.aspectRatio !== "string")
  ))) throw new Error("trusted blogImagePrompts are invalid");
  return value as BlogImagePrompt[];
}

function assertTrustedStringArray(value: unknown, field: string): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`trusted ${field} must be a string array`);
  }
  return value;
}

function assertTrustedLessons(
  value: unknown,
): Record<string, OperationalLessonInstruction[]> | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw new Error("trusted approvedLessonsByAgent must be an object");
  for (const lessons of Object.values(value)) {
    if (!Array.isArray(lessons) || lessons.some((lesson) => (
      !isRecord(lesson)
      || typeof lesson.lessonId !== "string" || !lesson.lessonId.trim()
      || typeof lesson.fingerprint !== "string" || !lesson.fingerprint.trim()
      || typeof lesson.title !== "string" || !lesson.title.trim()
      || typeof lesson.instruction !== "string" || !lesson.instruction.trim()
      || (lesson.policyVersion !== undefined && typeof lesson.policyVersion !== "string")
    ))) throw new Error("trusted approvedLessonsByAgent entries are invalid");
  }
  return value as Record<string, OperationalLessonInstruction[]>;
}

export function assertPublicContentPipelineInput(input: unknown): ContentPipelineInput {
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
  if (!topic) throw new Error("topic is required");
  if (!title) throw new Error("title is required");
  if (!channels.has(channel)) throw new Error("channel must be blog/instagram/youtube/newsletter");
  if (!["mock", "hermes-dry-run", "hermes"].includes(runnerMode)) throw new Error("runnerMode must be mock/hermes-dry-run/hermes");
  return {
    topic,
    title,
    channel: channel as ContentChannel,
    runnerMode: runnerMode as ContentPipelineInput["runnerMode"],
    contentType,
  };
}

/**
 * Scheduler-only boundary. Public requests are deliberately unable to inject
 * reference bundles, image prompts, or editorial instructions. Internal
 * callers pass typed, already-collected data and retain it after base input
 * validation.
 */
export function assertTrustedContentPipelineInput(input: ContentPipelineInput): ContentPipelineInput {
  const base = assertPublicContentPipelineInput(input);
  const referenceBundle = assertTrustedReferenceBundle(input.referenceBundle);
  if (referenceBundle) {
    if (!base.contentType) throw new Error("trusted contentType is required with referenceBundle");
    if (referenceBundle.contentType !== base.contentType) {
      throw new Error("trusted referenceBundle contentType must match input contentType");
    }
  }
  const operationalRunKey = input.operationalRunKey === undefined
    ? undefined
    : typeof input.operationalRunKey === "string" && input.operationalRunKey.trim()
      ? input.operationalRunKey.trim().slice(0, 240)
      : (() => { throw new Error("trusted operationalRunKey is invalid"); })();
  const operationalAttempt = input.operationalAttempt === undefined
    ? undefined
    : typeof input.operationalAttempt === "number" && Number.isInteger(input.operationalAttempt) && input.operationalAttempt > 0
      ? input.operationalAttempt
      : (() => { throw new Error("trusted operationalAttempt is invalid"); })();
  return {
    ...base,
    referenceBundle,
    blogImagePrompts: assertTrustedBlogImagePrompts(input.blogImagePrompts),
    editorialBenchmarkGuidelines: assertTrustedStringArray(input.editorialBenchmarkGuidelines, "editorialBenchmarkGuidelines"),
    approvedLessonsByAgent: assertTrustedLessons(input.approvedLessonsByAgent),
    operationalRunKey,
    operationalAttempt,
  };
}
