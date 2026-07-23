import { STOCK_BLOG_EDITORIAL_QUALITY_TARGET } from "./stock-blog-editorial-benchmark";

export const STOCK_BLOG_MAX_QA_ATTEMPTS = 3;
export const STOCK_BLOG_MAX_HERMES_RUNS = 2 + (STOCK_BLOG_MAX_QA_ATTEMPTS * 2);

type QaRevisionResult = Record<string, unknown>;

function stringList(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

export function shouldRetryStockBlogQa(result: QaRevisionResult, completedAttempts: number) {
  if (completedAttempts >= STOCK_BLOG_MAX_QA_ATTEMPTS || result.ok !== true) return false;
  const score = typeof result.qaScore === "number" ? result.qaScore : 0;
  const requiredRevisions = stringList(result.requiredRevisions);
  return score < STOCK_BLOG_EDITORIAL_QUALITY_TARGET
    || result.publishReadiness !== "ready"
    || result.finalRecommendation !== "approve"
    || requiredRevisions.length > 0;
}

export function buildStockBlogQaRevisionFeedback(result: QaRevisionResult) {
  return {
    qaSummary: typeof result.qaSummary === "string" ? result.qaSummary : undefined,
    factCheckNotes: stringList(result.factCheckNotes),
    qualityNotes: stringList(result.qualityNotes),
    riskNotes: stringList(result.riskNotes),
    typoAndStyleNotes: stringList(result.typoAndStyleNotes),
    requiredRevisions: stringList(result.requiredRevisions),
    optionalSuggestions: stringList(result.optionalSuggestions),
    publishReadiness: typeof result.publishReadiness === "string" ? result.publishReadiness : undefined,
    qaScore: typeof result.qaScore === "number" ? result.qaScore : undefined,
    finalRecommendation: typeof result.finalRecommendation === "string" ? result.finalRecommendation : undefined,
    reason: typeof result.reason === "string" ? result.reason : undefined,
  };
}
