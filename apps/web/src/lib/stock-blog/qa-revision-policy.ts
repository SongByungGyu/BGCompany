import { STOCK_BLOG_EDITORIAL_QUALITY_TARGET } from "./stock-blog-editorial-benchmark";

export const STOCK_BLOG_MAX_QA_ATTEMPTS = 3;
export const STOCK_BLOG_MAX_HERMES_RUNS = 2 + (STOCK_BLOG_MAX_QA_ATTEMPTS * 2);
export const STOCK_BLOG_MIN_BODY_LENGTH = 2000;
export const STOCK_BLOG_MAX_BODY_LENGTH = 3200;

type QaRevisionResult = Record<string, unknown>;

function stringList(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

function draftLength(writerResult?: QaRevisionResult) {
  return typeof writerResult?.fullDraft === "string"
    ? writerResult.fullDraft.length
    : undefined;
}

function draftLengthRevision(writerResult?: QaRevisionResult) {
  const length = draftLength(writerResult);
  if (length === undefined) return undefined;
  if (length >= STOCK_BLOG_MIN_BODY_LENGTH && length <= STOCK_BLOG_MAX_BODY_LENGTH) return undefined;
  return `최종 공개 본문을 공백 포함 ${STOCK_BLOG_MIN_BODY_LENGTH}~${STOCK_BLOG_MAX_BODY_LENGTH}자로 작성하세요. 현재 ${length}자입니다. 검증된 참고자료 안에서만 설명을 보강하고 수치·일정은 추정하지 마세요.`;
}

export function shouldRetryStockBlogQa(
  result: QaRevisionResult,
  completedAttempts: number,
  writerResult?: QaRevisionResult,
) {
  if (completedAttempts >= STOCK_BLOG_MAX_QA_ATTEMPTS || result.ok !== true) return false;
  const score = typeof result.qaScore === "number" ? result.qaScore : 0;
  const requiredRevisions = stringList(result.requiredRevisions);
  return Boolean(draftLengthRevision(writerResult))
    || score < STOCK_BLOG_EDITORIAL_QUALITY_TARGET
    || result.publishReadiness !== "ready"
    || result.finalRecommendation !== "approve"
    || requiredRevisions.length > 0;
}

export function buildStockBlogQaRevisionFeedback(
  result: QaRevisionResult,
  writerResult?: QaRevisionResult,
) {
  const requiredRevisions = stringList(result.requiredRevisions);
  const lengthRevision = draftLengthRevision(writerResult);
  if (lengthRevision && !requiredRevisions.includes(lengthRevision)) {
    requiredRevisions.push(lengthRevision);
  }
  return {
    qaSummary: typeof result.qaSummary === "string" ? result.qaSummary : undefined,
    factCheckNotes: stringList(result.factCheckNotes),
    qualityNotes: stringList(result.qualityNotes),
    riskNotes: stringList(result.riskNotes),
    typoAndStyleNotes: stringList(result.typoAndStyleNotes),
    requiredRevisions,
    optionalSuggestions: stringList(result.optionalSuggestions),
    publishReadiness: typeof result.publishReadiness === "string" ? result.publishReadiness : undefined,
    qaScore: typeof result.qaScore === "number" ? result.qaScore : undefined,
    finalRecommendation: typeof result.finalRecommendation === "string" ? result.finalRecommendation : undefined,
    reason: typeof result.reason === "string" ? result.reason : undefined,
  };
}
