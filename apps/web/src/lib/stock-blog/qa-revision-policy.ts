import type { StockReferenceBriefingTemplate } from "./references/reference-types.ts";
import {
  BG_MARKET_NOTE_EDITORIAL_POLICY_VERSION,
  getStockBlogEditorialPolicy,
  inspectStockBlogEditorialContract,
} from "./stock-blog-editorial-policy.ts";
import { STOCK_BLOG_EDITORIAL_QUALITY_TARGET } from "./stock-blog-quality-target.ts";

export const STOCK_BLOG_MAX_QA_ATTEMPTS = 3;
export const STOCK_BLOG_MAX_HERMES_RUNS = 2 + (STOCK_BLOG_MAX_QA_ATTEMPTS * 2);
export const STOCK_BLOG_MIN_BODY_LENGTH = 1800;
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

function draftLengthRevision(
  writerResult?: QaRevisionResult,
  contentType: StockReferenceBriefingTemplate = "KOREA_DAILY_PREVIEW",
) {
  const length = draftLength(writerResult);
  if (length === undefined) return undefined;
  const { bodyLength } = getStockBlogEditorialPolicy(contentType);
  if (length >= bodyLength.min && length <= bodyLength.max) return undefined;
  return `최종 공개 본문을 공백 포함 ${bodyLength.min}~${bodyLength.max}자로 작성하고 ${bodyLength.targetMin}~${bodyLength.targetMax}자를 목표로 하세요. 현재 ${length}자입니다. 검증된 참고자료 안에서만 설명을 보강하고 수치·일정은 추정하지 마세요.`;
}

function editorialContractRevisions(
  writerResult?: QaRevisionResult,
  contentType: StockReferenceBriefingTemplate = "KOREA_DAILY_PREVIEW",
) {
  if (typeof writerResult?.fullDraft !== "string") return [];
  return inspectStockBlogEditorialContract(writerResult.fullDraft, contentType).violations
    .map((violation) => `편집 정책 v${BG_MARKET_NOTE_EDITORIAL_POLICY_VERSION} 필수 수정: ${violation}`);
}

export function shouldRetryStockBlogQa(
  result: QaRevisionResult,
  completedAttempts: number,
  writerResult?: QaRevisionResult,
  contentType: StockReferenceBriefingTemplate = "KOREA_DAILY_PREVIEW",
) {
  if (completedAttempts >= STOCK_BLOG_MAX_QA_ATTEMPTS || result.ok !== true) return false;
  const score = typeof result.qaScore === "number" ? result.qaScore : 0;
  const requiredRevisions = stringList(result.requiredRevisions);
  return Boolean(draftLengthRevision(writerResult, contentType))
    || editorialContractRevisions(writerResult, contentType).length > 0
    || score < STOCK_BLOG_EDITORIAL_QUALITY_TARGET
    || result.publishReadiness !== "ready"
    || result.finalRecommendation !== "approve"
    || requiredRevisions.length > 0;
}

export function buildStockBlogQaRevisionFeedback(
  result: QaRevisionResult,
  writerResult?: QaRevisionResult,
  contentType: StockReferenceBriefingTemplate = "KOREA_DAILY_PREVIEW",
) {
  const requiredRevisions = stringList(result.requiredRevisions);
  const lengthRevision = draftLengthRevision(writerResult, contentType);
  if (lengthRevision && !requiredRevisions.includes(lengthRevision)) {
    requiredRevisions.push(lengthRevision);
  }
  for (const revision of editorialContractRevisions(writerResult, contentType)) {
    if (!requiredRevisions.includes(revision)) requiredRevisions.push(revision);
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
