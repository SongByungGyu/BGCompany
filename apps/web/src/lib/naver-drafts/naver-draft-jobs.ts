import { randomUUID, timingSafeEqual } from "node:crypto";
import type { NaverDraftJob, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getContentPipelineDetail } from "@/lib/content-pipeline/content-pipeline-service";
import type { ContentPipelineRun, StockBriefingTemplate } from "@/features/content-pipeline/content-pipeline-types";
import type { CompetitorBlogReference, ReferenceBundle, ReferenceItem } from "@/lib/stock-blog/references/reference-types";
import { buildStockBlogThumbnail, inferStockBriefingTemplateFromPipeline } from "@/lib/stock-blog/thumbnail-automation";
import { resolveStockBriefingNaverCategory } from "@/lib/naver-drafts/naver-category";
import {
  evaluateStockBlogPublishQuality,
  getRealStockReferences,
  inspectStockBlogImagePublishReadiness,
  inspectStockBlogQaApproval,
} from "@/lib/stock-blog/quality-gate";
import { FRED_DEGRADED_DISCLOSURE, isAllowedFredDegradedSnapshot } from "@/lib/stock-blog/references/fred-degraded-policy";
import { KIS_SECTOR_DEGRADED_DISCLOSURE, isAllowedKisSectorDegradedSnapshot } from "@/lib/stock-blog/references/kis-sector-degraded-policy";
import { KIS_OVERSEAS_DEGRADED_DISCLOSURE, isAllowedKisOverseasDegradedSnapshot } from "@/lib/stock-blog/references/kis-overseas-degraded-policy";
import { canonicalizeStockBlogBody } from "@/lib/stock-blog/canonical-stock-blog-body";
import { renderNaverBody, type NaverBodyBlock } from "@/lib/stock-blog/naver-body";
import { selectBestStockBlogEditorialTitle } from "@/lib/stock-blog/stock-blog-title";
import {
  evaluateNaverDraftSafeRetry,
  getNaverDraftSafeRetryLimit,
  shouldActivateNaverPublishCircuitBreaker,
} from "@/lib/naver-drafts/naver-draft-retry-policy";
import {
  canRequeueNaverAuthHoldJob,
  evaluateNaverAuthHold,
  evaluateNaverSessionReadyProbe,
  getNaverAuthHoldCooldownMs,
  isNaverAuthHoldProgressAllowed,
  isNaverAuthHoldStatus,
  isNaverSessionReadyProgress,
  NAVER_AUTH_HOLD_EVENT_ID,
  parseNaverAuthHoldSnapshot,
} from "@/lib/naver-drafts/naver-auth-hold-policy";
import {
  isAllowedNaverAgentTransition,
  isNaverDraftTerminalStatus,
  isNaverPublishingStale,
} from "@/lib/naver-drafts/naver-draft-state-policy";
import { isAllowedNaverPublishedResult } from "@/lib/naver-drafts/naver-published-url-policy";
import {
  appendRelatedPostSection,
  buildNaverDiscoveryTags,
  inspectPublishedPostSimilarity,
  selectRelatedPublishedPosts,
  type PublishedPostCandidate,
} from "@/lib/stock-blog/stock-blog-discovery";
import type { StockBlogContentImage, StockBlogImageQualityAudit } from "@/lib/stock-blog/stock-blog-image-types";
import {
  getStockBlogEditorialPolicy,
  STOCK_BLOG_INVESTMENT_DISCLAIMER,
} from "@/lib/stock-blog/stock-blog-editorial-policy";
import {
  isNaverDraftClaimDue,
  isNaverDraftPublishDue,
  isNaverDraftScheduleExpired,
  isNaverDraftScheduleInvalid,
  resolveNaverDraftSchedule,
} from "@/lib/naver-drafts/naver-draft-schedule-policy";

export type NaverDraftJobStatus =
  | "created"
  | "queued"
  | "claimed"
  | "in_progress"
  | "image_uploading"
  | "draft_saving"
  | "draft_saved"
  | "publish_ready"
  | "publishing"
  | "published"
  | "user_publish_required"
  | "completed"
  | "failed"
  | "login_required"
  | "captcha_required"
  | "security_check_required"
  | "readability_failed"
  | "image_upload_failed"
  | "image_quality_failed"
  | "draft_save_failed"
  | "publish_blocked"
  | "publish_failed"
  | "duplicate_blocked"
  | "quality_failed"
  | "reference_failed"
  | "market_data_failed"
  | "cancelled";

export type SerializedNaverDraftJob = {
  id: string;
  contentPipelineId: string | null;
  stockBlogContentId: string | null;
  approvalId: string | null;
  status: NaverDraftJobStatus | string;
  title: string;
  body: string;
  markdownBody: string | null;
  htmlBody: string | null;
  tags: string[];
  category: string | null;
  thumbnailText: string | null;
  thumbnailPrompt: string | null;
  thumbnailTitle: string | null;
  thumbnailSubtitle: string | null;
  thumbnailHook: string | null;
  thumbnailStyle: string | null;
  thumbnailImageUrl: string | null;
  thumbnailTemplateType: string | null;
  thumbnailPrimaryText: string | null;
  thumbnailSecondaryText: string | null;
  thumbnailKeywords: string[];
  inlineImageUrls: string[];
  imageStatus: string | null;
  contentImages: StockBlogContentImage[];
  imageQuality: StockBlogImageQualityAudit | null;
  references: ReferenceItem[];
  competitorBlogReferences: CompetitorBlogReference[];
  allowImageUpload: boolean;
  disclaimer: string | null;
  externalUrl: string | null;
  allowPublish: boolean;
  publishKey: string | null;
  marketDate: string | null;
  scheduleSlot: string | null;
  publishNotBefore: string | null;
  claimAvailableAt: string | null;
  publishedAt: string | null;
  publishedUrl: string | null;
  naverPostId: string | null;
  publishAttemptCount: number;
  publishMethod: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  claimedBy: string | null;
  claimedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type StatusReportInput = {
  status: NaverDraftJobStatus;
  claimedBy?: string;
  externalUrl?: string;
  publishedUrl?: string;
  naverPostId?: string;
  errorCode?: string;
  errorMessage?: string;
  leaseClaimedAt?: string;
};

type DraftQualityCheck = {
  ok: boolean;
  code?: "NAVER_DRAFT_QUALITY_FAILED" | "NAVER_DRAFT_NEEDS_REFERENCE" | "NAVER_DRAFT_DUPLICATE_CONTENT_BLOCKED";
  reasons: string[];
};

type DraftBuildResult = {
  title: string;
  body: string;
  markdownBody: string;
  htmlBody: string;
  tags: string[];
  category: string;
  thumbnailText: string;
  thumbnailPrompt: string;
  disclaimer: string;
};

const activeStatuses = ["queued", "claimed", "in_progress", "image_uploading", "draft_saving", "draft_saved", "publish_ready", "publishing", "user_publish_required"];
const PUBLISH_CIRCUIT_BREAKER_EVENT_ID = "event-stock-auto-publish-circuit-breaker";

async function withNaverSerializableTransaction<T>(
  work: (tx: Prisma.TransactionClient) => Promise<T>,
) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await prisma.$transaction(work, { isolationLevel: "Serializable" });
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error
        ? String((error as { code?: unknown }).code ?? "")
        : "";
      if (code !== "P2034" || attempt === 2) throw error;
    }
  }
  throw new Error("NAVER_DRAFT_TRANSACTION_RETRY_EXHAUSTED");
}

const INVESTMENT_DISCLAIMER = STOCK_BLOG_INVESTMENT_DISCLAIMER;

const WEEKEND_FORBIDDEN_PHRASES = ["장전 브리핑", "장마감", "장 마감", "오늘 장 초반", "장 시작 전", "금일 장중", "장중 대응"];

const STOCK_BRIEFING_COPY: Record<StockBriefingTemplate, {
  fallbackTitle: string;
  category: string;
  requiredTags: string[];
}> = {
  KOREA_DAILY_PREVIEW: {
    fallbackTitle: "오늘 코스피 전망: 전일 한국장과 간밤 미국장 체크",
    category: "오늘의 한국장 전망",
    requiredTags: ["한국증시", "장전브리핑", "코스피", "코스닥", "시장체크"],
  },
  KOREA_MARKET_CLOSE_US_PREVIEW: {
    fallbackTitle: "오늘 미국장 전망: 전일 나스닥과 금리·일정 체크",
    category: "오늘의 미국장 전망",
    requiredTags: ["미국장전망", "나스닥", "S&P500", "미국금리", "경제일정"],
  },
  WEEKLY_MARKET_REVIEW: {
    fallbackTitle: "이번 주 증시 정리: 코스피·나스닥·주도 업종",
    category: "주간 시장 정리",
    requiredTags: ["주간증시", "한국증시", "미국증시", "주간수급", "주도업종"],
  },
  NEXT_WEEK_MARKET_PREVIEW: {
    fallbackTitle: "다음 주 주요 이슈와 영향 섹터·일정",
    category: "주요 이슈/섹터",
    requiredTags: ["다음주증시", "주요이슈", "수혜섹터", "경제일정", "투자체크리스트"],
  },
  INVESTMENT_STUDY: {
    fallbackTitle: "주식 기초 공부: 숫자로 이해하는 투자 개념",
    category: "투자 공부",
    requiredTags: ["투자공부", "주식기초", "재무제표", "주식용어", "투자체크리스트"],
  },
  LARGE_CAP_DISCLOSURE_EARNINGS: {
    fallbackTitle: "대형주 공시·실적 발표 핵심 숫자 분석",
    category: "공시/실적 체크",
    requiredTags: ["공시분석", "실적발표", "대형주", "기업분석", "실적체크"],
  },
};

function clean(value?: string | null) {
  return typeof value === "string" ? value.trim() : "";
}

function unique(items: Array<string | undefined | null>) {
  return Array.from(new Set(items.map((item) => clean(item).replace(/^#/, "")).filter(Boolean)));
}

function htmlEscape(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function toHtml(body: string) {
  return body
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) => {
      const lines = paragraph.split("\n");
      if (lines.every((line) => line.trim().startsWith("- "))) {
        const items = lines.map((line) => `<li>${htmlEscape(line.replace(/^- /, "").trim())}</li>`).join("");
        return `<ul>${items}</ul>`;
      }
      return `<p>${htmlEscape(paragraph).replaceAll("\n", "<br />")}</p>`;
    })
    .join("\n");
}

function stripMarkdownSyntax(value: string) {
  return value
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

function normalizeNaverBody(value: string, template: StockBriefingTemplate) {
  const normalized = stripMarkdownSyntax(value)
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/([.!?。])\s+(?=[가-힣A-Z0-9])/g, "$1\n\n");
  return sanitizeByTemplate(normalized, template);
}

function sanitizeByTemplate(value: string, template: StockBriefingTemplate) {
  if (template !== "WEEKLY_MARKET_REVIEW" && template !== "NEXT_WEEK_MARKET_PREVIEW" && template !== "INVESTMENT_STUDY") return value;
  return WEEKEND_FORBIDDEN_PHRASES.reduce((text, phrase) => text.replaceAll(phrase, "시장 정리"), value);
}

function sectionsToText(pipeline: ContentPipelineRun) {
  const writer = pipeline.writerResult;
  if (!writer) return "";
  const sections = writer.sections?.map((section) => {
    const heading = clean(section.heading);
    const body = clean(section.body);
    if (heading && body) return `${heading}\n${body}`;
    return heading || body;
  }).filter(Boolean) ?? [];
  if (sections.length > 0) return sections.join("\n\n");
  if (clean(writer.fullDraft)) return clean(writer.fullDraft);
  if (clean(writer.markdownDraft)) return clean(writer.markdownDraft);
  return [writer.introduction, writer.conclusion]
    .map(clean)
    .filter(Boolean)
    .join("\n\n");
}

function collectReferenceBundle(pipeline: ContentPipelineRun): ReferenceBundle | undefined {
  return pipeline.referenceBundle
    ?? pipeline.writerResult?.referenceBundle
    ?? pipeline.qaResult?.referenceBundle
    ?? pipeline.marketingResult?.referenceBundle;
}


function collectReferences(pipeline: ContentPipelineRun) {
  const bundle = collectReferenceBundle(pipeline);
  const realReferences = getRealStockReferences(bundle);
  if (pipeline.runnerMode === "hermes") return realReferences.slice(0, 5);
  return (realReferences.length > 0 ? realReferences : [...(bundle?.items ?? [])]).slice(0, 5);
}

function ensureMeaningfulParagraph(value: string, fallback: string) {
  const cleaned = clean(value);
  if (!cleaned) return fallback;
  if (cleaned.length < 45) return `${cleaned} ${fallback}`;
  return cleaned;
}

function buildSectionBody(pipeline: ContentPipelineRun, index: number, template: StockBriefingTemplate) {
  const writerText = normalizeNaverBody(sectionsToText(pipeline), template);
  const writerSections = writerText.split(/\n{2,}/).map(clean).filter(Boolean);
  const source = writerSections[index] || writerSections[index + 1] || "";
  const commonFallbacks = [
    `${pipeline.topic}을 기준으로 시장의 방향성보다 확인해야 할 변수를 먼저 정리했습니다.`,
    "지수 방향을 단정하기보다 수급, 환율, 금리, 섹터 순환을 함께 확인하는 접근이 필요합니다.",
    "단기 뉴스에 과하게 반응하기보다 실제 거래대금과 외국인·기관 수급 변화가 동반되는지 보는 것이 좋습니다.",
    "반도체, 2차전지, 금융, 플랫폼, 방산 등 주요 업종의 상대 강도를 비교해보면 시장의 색깔을 더 명확히 볼 수 있습니다.",
    "오늘 또는 다음 주 매매 판단은 하나의 지표가 아니라 일정, 실적, 금리, 환율, 수급을 함께 놓고 확인하는 편이 안전합니다.",
    "아래 참고자료는 원문을 복사하기 위한 것이 아니라 시장을 해석하는 방향을 잡기 위한 신호로만 활용했습니다.",
    "주말에는 당일 매매보다 한 주의 흐름을 복기하고 다음 주 체크리스트를 만드는 데 초점을 맞추는 편이 좋습니다.",
  ];
  return ensureMeaningfulParagraph(source, commonFallbacks[index] ?? commonFallbacks[0]);
}

function buildChecklist(template: StockBriefingTemplate) {
  if (template === "KOREA_DAILY_PREVIEW") {
    return [
      "미국 10년물 금리와 달러 인덱스가 국내 성장주에 부담을 주는지 확인",
      "외국인 선물·현물 수급이 같은 방향으로 움직이는지 확인",
      "반도체와 2차전지 대형주의 거래대금이 살아나는지 확인",
    ];
  }
  if (template === "KOREA_MARKET_CLOSE_US_PREVIEW") {
    return [
      "전일 나스닥·S&P500 방향과 현재 미국 선물의 차이 확인",
      "미국 2년물·10년물 금리와 달러 방향 확인",
      "오늘 밤 경제지표·연준 발언·주요 기업 실적 시간 확인",
    ];
  }
  if (template === "NEXT_WEEK_MARKET_PREVIEW") {
    return [
      "다음 주 주요 경제지표 발표 일정 확인",
      "대형 기술주 실적 또는 가이던스 관련 이벤트 확인",
      "환율·금리 방향이 국내 수급에 미칠 영향 점검",
    ];
  }
  if (template === "INVESTMENT_STUDY") {
    return [
      "계산식의 분자·분모와 비교 기준을 같은 시점으로 맞췄는지 확인",
      "한 기업의 숫자를 업종 평균과 실제 시장 환경에 함께 비교",
      "지표 하나로 결론 내리지 않고 현금흐름·부채·성장 조건을 함께 점검",
    ];
  }
  if (template === "LARGE_CAP_DISCLOSURE_EARNINGS") {
    return [
      "DART 또는 SEC 원문의 발표값과 비교 기준 확인",
      "일회성 손익을 제외한 매출·영업이익·현금흐름 변화 점검",
      "다음 분기 가이던스와 주가 판단이 바뀌는 조건 확인",
    ];
  }
  return [
    "이번 주 강했던 업종과 약했던 업종을 분리해서 복기",
    "외국인·기관 수급이 지수 상승을 뒷받침했는지 확인",
    "미국장 변수와 국내 섹터 흐름이 같은 방향이었는지 점검",
  ];
}

function buildPlainBody(pipeline: ContentPipelineRun, template: StockBriefingTemplate, title: string, refs: ReferenceItem[]) {
  const structure = getStockBlogEditorialPolicy(template).bodyStructure;
  const articleHeadingIndex = structure.indexOf("함께 확인한 기사");
  const checklistHeadingIndex = structure.findIndex((heading) => /볼\s*것\s*3가지/.test(heading));
  const introHeading = structure[0] ?? "1. 30초 요약";
  const analysisHeadings = structure.slice(1, checklistHeadingIndex);
  const closingHeadings = structure.slice(checklistHeadingIndex + 1, articleHeadingIndex);
  const snapshot = collectReferenceBundle(pipeline)?.marketSnapshot;
  const marketDisclosureBlocks: NaverBodyBlock[] = [
    ...(isAllowedFredDegradedSnapshot(snapshot) ? [{ type: "paragraph" as const, text: FRED_DEGRADED_DISCLOSURE }] : []),
    ...(isAllowedKisSectorDegradedSnapshot(snapshot) ? [{ type: "paragraph" as const, text: KIS_SECTOR_DEGRADED_DISCLOSURE }] : []),
    ...(isAllowedKisOverseasDegradedSnapshot(snapshot) ? [{ type: "paragraph" as const, text: KIS_OVERSEAS_DEGRADED_DISCLOSURE }] : []),
  ];
  const blocks: NaverBodyBlock[] = [
    { type: "heading", text: title },
    { type: "heading", text: introHeading },
    { type: "intro", text: ensureMeaningfulParagraph(
      clean(pipeline.writerResult?.introduction) || clean(pipeline.outputSummary),
      `${pipeline.topic}을 중심으로 시장 흐름, 수급, 섹터, 이벤트를 블로그 독자가 바로 확인할 수 있게 정리했습니다.`,
    ) },
    ...analysisHeadings.flatMap<NaverBodyBlock>((heading, index) => [
      { type: "heading", text: heading },
      { type: "paragraph", text: buildSectionBody(pipeline, index, template) },
    ]),
    { type: "heading", text: structure[checklistHeadingIndex] ?? "6. 오늘 볼 것 3가지" },
    { type: "bulletList", items: buildChecklist(template) },
    ...closingHeadings.flatMap<NaverBodyBlock>((heading, index) => [
      { type: "heading", text: heading },
      { type: "paragraph", text: buildSectionBody(pipeline, analysisHeadings.length + index, template) },
    ]),
    { type: "heading", text: "마무리" },
    { type: "paragraph", text: clean(pipeline.writerResult?.conclusion) || "시장은 매일 다른 신호를 주지만, 중요한 것은 방향을 단정하기보다 확인할 변수를 근거별로 줄여가는 것입니다." },
    { type: "heading", text: "함께 확인한 기사" },
    ...refs.filter((item) => item.sourceType === "news").slice(0, 3).map<NaverBodyBlock>((item, index) => ({ type: "reference", item, index: index + 1 })),
    ...marketDisclosureBlocks,
    { type: "disclaimer", text: INVESTMENT_DISCLAIMER },
  ];
  return sanitizeByTemplate(renderNaverBody(blocks), template);
}

function buildWriterEditorialBody(pipeline: ContentPipelineRun, template: StockBriefingTemplate) {
  const writer = pipeline.writerResult;
  if (!writer) return "";
  const canonicalDraft = clean(writer.fullDraft) || clean(writer.markdownDraft);
  if (canonicalDraft) {
    return sanitizeByTemplate(stripMarkdownSyntax(canonicalDraft)
      .replace(/\r\n?/g, "\n")
      .replace(/\n{3,}/g, "\n\n"), template);
  }
  const sections = writer.sections?.map((section) => {
    const heading = clean(section.heading);
    const body = clean(section.body).replaceAll(INVESTMENT_DISCLAIMER, "").trim();
    return [heading, body].filter(Boolean).join("\n");
  }).filter(Boolean) ?? [];
  const body = [
    clean(writer.introduction).replaceAll(INVESTMENT_DISCLAIMER, "").trim(),
    ...sections,
    "마무리",
    clean(writer.conclusion).replaceAll(INVESTMENT_DISCLAIMER, "").trim(),
    INVESTMENT_DISCLAIMER,
  ].filter(Boolean).join("\n\n");
  return sanitizeByTemplate(stripMarkdownSyntax(body)
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n"), template);
}

function buildMarkdownBody(title: string, body: string) {
  return `# ${title}\n\n${body}`;
}

function buildDraftQualityCheck(
  template: StockBriefingTemplate,
  title: string,
  body: string,
  refs: ReferenceItem[],
  pipeline: ContentPipelineRun,
  publishedPosts: PublishedPostCandidate[],
): DraftQualityCheck {
  const gate = evaluateStockBlogPublishQuality({
    pipeline,
    referenceBundle: collectReferenceBundle(pipeline),
    pasteReadyBody: body,
    writerText: sectionsToText(pipeline),
    requireRealReferences: pipeline.runnerMode === "hermes",
  });
  const reasons = [...gate.reasons];
  if ((template === "WEEKLY_MARKET_REVIEW" || template === "NEXT_WEEK_MARKET_PREVIEW" || template === "INVESTMENT_STUDY") && WEEKEND_FORBIDDEN_PHRASES.some((phrase) => body.includes(phrase))) {
    reasons.push("주말/주간 글에 장전·장마감 등 일일 브리핑 표현 포함");
  }
  const similarity = inspectPublishedPostSimilarity({ title, body, posts: publishedPosts });
  if (similarity.blocked) {
    return {
      ok: false,
      code: "NAVER_DRAFT_DUPLICATE_CONTENT_BLOCKED",
      reasons: [similarity.reason ?? "최근 게시글과 제목 또는 본문이 과도하게 유사함"],
    };
  }
  if (reasons.length === 0) return { ok: true, reasons: [] };
  return {
    ok: false,
    code: gate.status === "needs_reference" || refs.length < 3 ? "NAVER_DRAFT_NEEDS_REFERENCE" : "NAVER_DRAFT_QUALITY_FAILED",
    reasons,
  };
}


function buildDraftFromPipeline(pipeline: ContentPipelineRun, publishedPosts: PublishedPostCandidate[] = []): DraftBuildResult {
  const bundleTemplate = collectReferenceBundle(pipeline)?.contentType;
  const template = pipeline.naverBlogPublishPrep?.briefingTemplate
    ?? bundleTemplate
    ?? inferStockBriefingTemplateFromPipeline(pipeline);
  const copy = STOCK_BRIEFING_COPY[template];
  const marketDate = collectReferenceBundle(pipeline)?.marketDate || pipeline.createdAt;
  const titleSelection = selectBestStockBlogEditorialTitle({
    template,
    marketDate,
    candidates: [
      ...(pipeline.marketingResult?.titleSuggestions ?? []),
      pipeline.marketingResult?.recommendedTitle,
      pipeline.writerResult?.finalTitle,
      pipeline.plannerResult?.title,
      pipeline.outputTitle,
      pipeline.title,
      copy.fallbackTitle,
    ],
    recentTitles: publishedPosts.map((post) => post.title),
  });
  const title = sanitizeByTemplate(titleSelection.title, template);
  const thumbnail = pipeline.naverBlogPublishPrep ?? buildStockBlogThumbnail(pipeline, template);
  const thumbnailText = clean(thumbnail.thumbnailTitle) || clean(thumbnail.thumbnailPrimaryText) || `${title} 핵심 정리`;
  const thumbnailPrompt = clean(thumbnail.thumbnailPrompt) || `네이버 블로그 썸네일, 깔끔한 금융 리포트 스타일, 제목: ${title}, 핵심 문구: ${thumbnailText}`;
  const refs = collectReferences(pipeline);
  const writerBody = buildWriterEditorialBody(pipeline, template);
  const referenceBundle = collectReferenceBundle(pipeline);
  const snapshot = referenceBundle?.marketSnapshot;
  const canonicalWriterBody = canonicalizeStockBlogBody({
    body: writerBody,
    referenceItems: getRealStockReferences(referenceBundle),
    marketSnapshot: snapshot,
  });
  const baseBody = pipeline.runnerMode === "hermes" && canonicalWriterBody
    ? canonicalWriterBody
    : buildPlainBody(pipeline, template, title, refs);
  const body = canonicalizeStockBlogBody({
    body: appendRelatedPostSection({
      body: baseBody,
      template,
      posts: selectRelatedPublishedPosts({ currentTitle: title, posts: publishedPosts, limit: 2 }),
    }),
    referenceItems: getRealStockReferences(referenceBundle),
    marketSnapshot: snapshot,
  });
  const quality = buildDraftQualityCheck(template, title, body, refs, pipeline, publishedPosts);
  if (!quality.ok) {
    throw new Error(`${quality.code ?? "NAVER_DRAFT_QUALITY_FAILED"}: ${quality.reasons.join(" · ")}`);
  }
  const tags = buildNaverDiscoveryTags({
    seoKeywords: unique([
      ...(pipeline.writerResult?.usedSeoKeywords ?? []),
      ...(pipeline.marketingResult?.seoKeywords ?? []),
      ...(pipeline.plannerResult?.seoKeywords ?? []),
      ...(pipeline.naverBlogPublishPrep?.naverTags ?? []),
    ]),
    requiredTags: copy.requiredTags,
  });
  return {
    title,
    body,
    markdownBody: buildMarkdownBody(title, body),
    htmlBody: toHtml(body),
    tags,
    category: resolveStockBriefingNaverCategory(
      template,
      pipeline.naverBlogPublishPrep?.naverCategory ?? copy.category,
    ),
    thumbnailText,
    thumbnailPrompt,
    disclaimer: INVESTMENT_DISCLAIMER,
  };
}

export function serializeNaverDraftJob(job: NaverDraftJob): SerializedNaverDraftJob {
  const schedule = resolveNaverDraftSchedule(job);
  return {
    id: job.id,
    contentPipelineId: job.contentPipelineId,
    stockBlogContentId: job.stockBlogContentId,
    approvalId: job.approvalId,
    status: job.status,
    title: job.title,
    body: job.body,
    markdownBody: job.markdownBody,
    htmlBody: job.htmlBody,
    tags: job.tags,
    category: job.category,
    thumbnailText: job.thumbnailText,
    thumbnailPrompt: job.thumbnailPrompt,
    thumbnailTitle: job.thumbnailText,
    thumbnailSubtitle: null,
    thumbnailHook: null,
    thumbnailStyle: null,
    thumbnailImageUrl: null,
    thumbnailTemplateType: null,
    thumbnailPrimaryText: job.thumbnailText,
    thumbnailSecondaryText: null,
    thumbnailKeywords: job.thumbnailText ? [job.thumbnailText] : [],
    inlineImageUrls: [],
    imageStatus: null,
    contentImages: [],
    imageQuality: null,
    references: [],
    competitorBlogReferences: [],
    allowImageUpload: false,
    disclaimer: job.disclaimer,
    externalUrl: job.externalUrl,
    allowPublish: job.allowPublish,
    publishKey: job.publishKey,
    marketDate: job.marketDate,
    scheduleSlot: job.scheduleSlot,
    publishNotBefore: schedule?.publishNotBefore.toISOString() ?? null,
    claimAvailableAt: schedule?.claimAvailableAt.toISOString() ?? null,
    publishedAt: job.publishedAt?.toISOString() ?? null,
    publishedUrl: job.publishedUrl,
    naverPostId: job.naverPostId,
    publishAttemptCount: job.publishAttemptCount,
    publishMethod: job.publishMethod,
    errorCode: job.errorCode,
    errorMessage: job.errorMessage,
    claimedBy: job.claimedBy,
    claimedAt: job.claimedAt?.toISOString() ?? null,
    startedAt: job.startedAt?.toISOString() ?? null,
    completedAt: job.completedAt?.toISOString() ?? null,
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
  };
}

async function serializeNaverDraftJobWithPipeline(job: NaverDraftJob, knownPipeline?: ContentPipelineRun) {
  const detail = knownPipeline
    ? { pipeline: knownPipeline }
    : job.contentPipelineId
      ? await getContentPipelineDetail(job.contentPipelineId)
      : null;
  const pipeline = detail?.pipeline;
  if (!pipeline) return serializeNaverDraftJob(job);
  const prep = pipeline.naverBlogPublishPrep;
  const bundle = collectReferenceBundle(pipeline);
  return {
    ...serializeNaverDraftJob(job),
    thumbnailTitle: prep?.thumbnailTitle ?? job.thumbnailText,
    thumbnailSubtitle: prep?.thumbnailSubtitle ?? null,
    thumbnailHook: prep?.thumbnailHook ?? null,
    thumbnailStyle: prep?.thumbnailStyle ?? null,
    thumbnailImageUrl: pipeline.thumbnailImageUrl ?? prep?.thumbnailImageUrl ?? null,
    thumbnailTemplateType: prep?.thumbnailTemplateType ?? prep?.briefingTemplate ?? null,
    thumbnailPrimaryText: prep?.thumbnailPrimaryText ?? job.thumbnailText,
    thumbnailSecondaryText: prep?.thumbnailSecondaryText ?? null,
    thumbnailKeywords: prep?.thumbnailKeywords ?? (job.thumbnailText ? [job.thumbnailText] : []),
    inlineImageUrls: pipeline.inlineImageUrls ?? [],
    imageStatus: pipeline.imageStatus ?? null,
    contentImages: pipeline.contentImages ?? [],
    imageQuality: pipeline.imageQuality ?? null,
    references: getRealStockReferences(bundle).slice(0, 10),
    competitorBlogReferences: (bundle?.competitorBlogReferences ?? []).slice(0, 5),
    allowImageUpload: process.env.NAVER_ALLOW_IMAGE_UPLOAD === "true",
  } satisfies SerializedNaverDraftJob;
}

export function getNaverDraftPolicy() {
  return {
    requireApproval: process.env.NAVER_DRAFT_REQUIRE_APPROVAL !== "false",
    autoAfterQa: process.env.NAVER_DRAFT_AUTO_AFTER_QA === "true",
  };
}

function automaticPublishBlockReasons(pipeline: ContentPipelineRun, body: string) {
  const bundle = collectReferenceBundle(pipeline);
  const snapshot = bundle?.marketSnapshot;
  const qaApproval = inspectStockBlogQaApproval(pipeline.qaResult);
  const allowedDegradedSnapshot = isAllowedFredDegradedSnapshot(snapshot)
    || isAllowedKisSectorDegradedSnapshot(snapshot)
    || isAllowedKisOverseasDegradedSnapshot(snapshot);
  const quality = evaluateStockBlogPublishQuality({
    pipeline,
    referenceBundle: bundle,
    pasteReadyBody: body,
    writerText: sectionsToText(pipeline),
    requireRealReferences: true,
  });
  const reasons = [...quality.reasons];
  if (pipeline.runnerMode !== "hermes") reasons.push("Hermes 실운영 결과만 자동 발행 가능");
  if (!pipeline.plannerResult?.ok) reasons.push("content-planner 실패");
  if (!pipeline.marketingResult?.ok) reasons.push("marketing-manager 실패");
  if (!pipeline.writerResult?.ok) reasons.push("content-writer 실패");
  if (!qaApproval.ok) reasons.push(...qaApproval.reasons);
  if ((bundle?.missingItems?.length ?? 0) > 0 && !allowedDegradedSnapshot) reasons.push("Reference missingItems 존재");
  if ((bundle?.competitorAnalysis?.analyzedCount ?? 0) < 1) reasons.push("경쟁 블로그 심층 구조 분석 PASS 필요");
  if (snapshot?.status !== "ready") reasons.push("MarketSnapshot status=ready 필요");
  if (snapshot?.dataQuality !== "verified" && !allowedDegradedSnapshot) reasons.push("MarketSnapshot dataQuality=verified 필요");
  if (snapshot?.freshness?.status !== "fresh") reasons.push("MarketSnapshot freshness=fresh 필요");
  if (snapshot?.fallbackUsed !== false) reasons.push("MarketSnapshot fallbackUsed=false 필요");
  reasons.push(...inspectStockBlogImagePublishReadiness(pipeline));
  return Array.from(new Set(reasons));
}

async function upsertPublishCircuitBreaker(
  tx: Prisma.TransactionClient,
  job: NaverDraftJob,
  status: string,
  reason: string,
  summary: string,
) {
  const existing = await tx.eventLog.findUnique({ where: { id: PUBLISH_CIRCUIT_BREAKER_EVENT_ID } });
  const existingPayload = safeRetryEventPayload(existing?.payload);
  if (
    existingPayload.active === true
    && (existingPayload.status === "publish_failed" || existingPayload.status === "publishing_unknown")
  ) return false;
  await tx.eventLog.upsert({
    where: { id: PUBLISH_CIRCUIT_BREAKER_EVENT_ID },
    create: {
      id: PUBLISH_CIRCUIT_BREAKER_EVENT_ID,
      type: "StockBlogPublishCircuitBreaker",
      timestamp: new Date(),
      summary,
      payload: { active: true, jobId: job.id, status, reason, activatedAt: new Date().toISOString() },
    },
    update: {
      timestamp: new Date(),
      summary,
      payload: { active: true, jobId: job.id, status, reason, activatedAt: new Date().toISOString() },
    },
  });
  return true;
}

async function activatePublishCircuitBreaker(
  tx: Prisma.TransactionClient,
  job: NaverDraftJob,
  status: NaverDraftJobStatus,
  reason?: string,
) {
  if (!shouldActivateNaverPublishCircuitBreaker({
    allowPublish: job.allowPublish,
    status,
    publishAttemptCount: job.publishAttemptCount,
  })) return;
  await upsertPublishCircuitBreaker(
    tx,
    job,
    status,
    reason ?? "Automatic publish result is uncertain.",
    "자동 발행 결과가 불명확해 후속 자동 발행을 일시 중지했습니다.",
  );
}

async function activateStalePublishingCircuitBreaker(job: NaverDraftJob) {
  return withNaverSerializableTransaction(async (tx) => {
    const current = await tx.naverDraftJob.findUnique({ where: { id: job.id } });
    if (
      !current
      || current.status !== "publishing"
      || current.updatedAt.getTime() !== job.updatedAt.getTime()
      || !isNaverPublishingStale(current.updatedAt, new Date(), process.env.NAVER_PUBLISHING_STALE_SECONDS)
    ) return false;
    await upsertPublishCircuitBreaker(
      tx,
      current,
      "publishing_unknown",
      "The publishing lease stopped reporting before a verified result was received.",
      "발행 결과 확인 전 에이전트 응답이 끊겨 후속 자동 발행을 중지했습니다.",
    );
    return true;
  });
}

async function clearResolvedPublishingCircuitBreaker(tx: Prisma.TransactionClient, jobId: string) {
  const event = await tx.eventLog.findUnique({ where: { id: PUBLISH_CIRCUIT_BREAKER_EVENT_ID } });
  if (!event) return;
  const payload = safeRetryEventPayload(event.payload);
  if (payload.active !== true || payload.jobId !== jobId || payload.status !== "publishing_unknown") return;
  await tx.eventLog.update({
    where: { id: PUBLISH_CIRCUIT_BREAKER_EVENT_ID },
    data: {
      timestamp: new Date(),
      summary: "불명확했던 발행 결과가 공개 URL로 확인되어 차단을 해제했습니다.",
      payload: {
        ...payload,
        active: false,
        status: "publishing_resolved",
        clearedAt: new Date().toISOString(),
      } as Prisma.InputJsonObject,
    },
  });
}

export async function getPublishCircuitBreaker() {
  const event = await prisma.eventLog.findUnique({ where: { id: PUBLISH_CIRCUIT_BREAKER_EVENT_ID } });
  const payload = event && typeof event.payload === "object" && !Array.isArray(event.payload)
    ? event.payload as Record<string, Prisma.JsonValue>
    : {};
  return {
    active: payload.active === true,
    message: event?.summary ?? null,
    updatedAt: event?.timestamp.toISOString() ?? null,
  };
}

export async function listNaverDraftJobs(input: { contentPipelineId?: string | null } = {}) {
  const jobs = await prisma.naverDraftJob.findMany({
    where: input.contentPipelineId ? { contentPipelineId: input.contentPipelineId } : undefined,
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  return Promise.all(jobs.map((job) => serializeNaverDraftJobWithPipeline(job)));
}

export async function getNaverDraftJob(jobId: string) {
  const job = await prisma.naverDraftJob.findUnique({ where: { id: jobId } });
  return job ? serializeNaverDraftJobWithPipeline(job) : null;
}

export async function getNaverDraftAgentRuntimeStatus() {
  const [publishingJobs, activeAgentJobCount, publishCircuit, authHoldEvent] = await Promise.all([
    prisma.naverDraftJob.findMany({
      where: { allowPublish: true, status: "publishing" },
      orderBy: { updatedAt: "asc" },
      select: { id: true, claimedBy: true, claimedAt: true, updatedAt: true, publishAttemptCount: true },
    }),
    prisma.naverDraftJob.count({
      where: { status: { in: ["claimed", "in_progress", "image_uploading", "draft_saving", "publish_ready", "publishing"] } },
    }),
    getPublishCircuitBreaker(),
    prisma.eventLog.findUnique({ where: { id: NAVER_AUTH_HOLD_EVENT_ID } }),
  ]);
  const authHold = parseNaverAuthHoldSnapshot(authHoldEvent?.payload);
  return {
    publishingCount: publishingJobs.length,
    activeAgentJobCount,
    publishingJobs: publishingJobs.map((job) => ({
      id: job.id,
      claimedBy: job.claimedBy,
      claimedAt: job.claimedAt?.toISOString() ?? null,
      updatedAt: job.updatedAt.toISOString(),
      publishAttemptCount: job.publishAttemptCount,
    })),
    publishCircuit,
    authHold: {
      active: authHold.active,
      jobId: authHold.jobId,
      status: authHold.status,
      heldAt: authHold.heldAt,
    },
  };
}

export async function createNaverDraftJobFromPipeline(input: {
  contentPipelineId: string;
  approvalId?: string | null;
  allowPublish?: boolean;
  publishKey?: string | null;
  publishKeyAliases?: string[];
  marketDate?: string | null;
  scheduleSlot?: string | null;
}) {
  const detail = await getContentPipelineDetail(input.contentPipelineId);
  if (!detail) throw new Error("CONTENT_PIPELINE_NOT_FOUND");
  const publishKey = clean(input.publishKey);
  const acceptedPublishKeys = Array.from(new Set([
    publishKey,
    ...(input.publishKeyAliases ?? []).map((value) => clean(value)),
  ].filter(Boolean)));

  const approvalId = input.approvalId ?? detail.pipeline.approvalId ?? detail.approval?.id ?? null;
  const { requireApproval: requiresApproval } = getNaverDraftPolicy();
  if (requiresApproval && detail.approval?.status !== "승인 완료" && detail.pipeline.status !== "approved") {
    throw new Error("NAVER_DRAFT_REQUIRES_APPROVED_CONTENT");
  }
  if (!detail.pipeline.writerResult?.ok && !detail.pipeline.plannerResult?.ok) {
    throw new Error("NAVER_DRAFT_SOURCE_NOT_READY");
  }

  const existing = await prisma.naverDraftJob.findFirst({
    where: { contentPipelineId: detail.pipeline.id, status: { in: activeStatuses } },
    orderBy: { createdAt: "desc" },
  });
  if (existing) {
    if (input.allowPublish && (!existing.allowPublish || !acceptedPublishKeys.includes(existing.publishKey ?? ""))) {
      throw new Error("NAVER_EXISTING_DRAFT_NOT_PUBLISH_ENABLED");
    }
    return serializeNaverDraftJobWithPipeline(existing, detail.pipeline);
  }

  const publishedPosts = await prisma.naverDraftJob.findMany({
    where: {
      status: "published",
      publishedUrl: { not: null },
      contentPipelineId: { not: detail.pipeline.id },
    },
    orderBy: { publishedAt: "desc" },
    take: 12,
    select: { title: true, body: true, publishedUrl: true },
  });
  const draft = buildDraftFromPipeline(
    detail.pipeline,
    publishedPosts.flatMap((post) => post.publishedUrl ? [{ title: post.title, body: post.body, url: post.publishedUrl }] : []),
  );
  if (input.allowPublish) {
    const reasons = automaticPublishBlockReasons(detail.pipeline, draft.body);
    if (reasons.length > 0) throw new Error(`NAVER_AUTO_PUBLISH_PREFLIGHT_FAILED: ${reasons.join(" · ")}`);
    if (!publishKey || !clean(input.marketDate) || !clean(input.scheduleSlot)) {
      throw new Error("NAVER_AUTO_PUBLISH_IDEMPOTENCY_FIELDS_REQUIRED");
    }
    if (isNaverDraftScheduleInvalid({ marketDate: input.marketDate, scheduleSlot: input.scheduleSlot })) {
      throw new Error("NAVER_AUTO_PUBLISH_SCHEDULE_INVALID");
    }
    const duplicate = await prisma.naverDraftJob.findFirst({
      where: {
        OR: [
          { publishKey: { in: acceptedPublishKeys } },
          { contentPipelineId: detail.pipeline.id, status: "published" },
          { title: draft.title, marketDate: input.marketDate, status: "published" },
        ],
      },
    });
    if (duplicate) throw new Error("NAVER_AUTO_PUBLISH_DUPLICATE_BLOCKED");
  }
  const job = await prisma.naverDraftJob.create({
    data: {
      id: `naver-draft-${randomUUID()}`,
      contentPipelineId: detail.pipeline.id,
      approvalId,
      status: "queued",
      allowPublish: input.allowPublish === true,
      publishKey: publishKey || null,
      marketDate: clean(input.marketDate) || null,
      scheduleSlot: clean(input.scheduleSlot) || null,
      ...draft,
    },
  });
  return serializeNaverDraftJobWithPipeline(job, detail.pipeline);
}

export async function cancelNaverDraftJob(jobId: string) {
  const job = await prisma.naverDraftJob.findUnique({ where: { id: jobId } });
  if (!job) return null;
  if (isNaverDraftTerminalStatus(job.status) || job.status === "publishing") {
    throw new Error("NAVER_DRAFT_JOB_ALREADY_FINISHED");
  }
  const cancelled = await withNaverSerializableTransaction(async (tx) => {
    const result = await tx.naverDraftJob.updateMany({
      where: {
        id: jobId,
        status: job.status,
        claimedBy: job.claimedBy,
        claimedAt: job.claimedAt,
        updatedAt: job.updatedAt,
      },
      data: { status: "cancelled", claimedBy: null, claimedAt: null, completedAt: new Date() },
    });
    if (result.count !== 1) throw new Error("NAVER_DRAFT_JOB_STALE_STATE");
    const updated = await tx.naverDraftJob.findUnique({ where: { id: jobId } });
    if (!updated) throw new Error("NAVER_DRAFT_JOB_NOT_FOUND");
    await clearNaverAuthHold(tx, jobId, "AUTH_HOLD_JOB_CANCELLED");
    return updated;
  });
  return serializeNaverDraftJobWithPipeline(cancelled);
}

function maxClaimAgeDate() {
  const minutes = Number(process.env.NAVER_DRAFT_MAX_CLAIM_MINUTES ?? "10");
  const safeMinutes = Number.isFinite(minutes) && minutes > 0 ? minutes : 10;
  return new Date(Date.now() - safeMinutes * 60 * 1000);
}

const reclaimablePrePublishStatuses = [
  "claimed",
  "in_progress",
  "image_uploading",
  "draft_saving",
  "publish_ready",
];

function safeRetryEventPayload(value: Prisma.JsonValue | undefined) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, Prisma.JsonValue>
    : {};
}

function isClaimableNaverJob(job: Pick<NaverDraftJob, "status" | "updatedAt" | "allowPublish">, staleBefore: Date) {
  return job.status === "queued"
    || (job.allowPublish
      && reclaimablePrePublishStatuses.includes(job.status)
      && job.updatedAt < staleBefore);
}

function getLeaseClaimedAt(input: Pick<StatusReportInput, "leaseClaimedAt">) {
  const value = clean(input.leaseClaimedAt);
  const timestamp = Date.parse(value);
  if (!value || !Number.isFinite(timestamp)) throw new Error("NAVER_DRAFT_LEASE_REQUIRED");
  return new Date(timestamp);
}

function assertOwnedNaverLease(
  job: Pick<NaverDraftJob, "claimedBy" | "claimedAt">,
  input: Pick<StatusReportInput, "claimedBy" | "leaseClaimedAt">,
) {
  const leaseClaimedAt = getLeaseClaimedAt(input);
  if (!job.claimedBy || !input.claimedBy || job.claimedBy !== input.claimedBy) {
    throw new Error("NAVER_DRAFT_LEASE_AGENT_MISMATCH");
  }
  if (!job.claimedAt || job.claimedAt.getTime() !== leaseClaimedAt.getTime()) {
    throw new Error("NAVER_DRAFT_LEASE_STALE");
  }
  return leaseClaimedAt;
}

async function updateOwnedNaverJob(
  tx: Prisma.TransactionClient,
  job: NaverDraftJob,
  input: Pick<StatusReportInput, "claimedBy" | "leaseClaimedAt">,
  data: Prisma.NaverDraftJobUpdateManyMutationInput,
) {
  const leaseClaimedAt = assertOwnedNaverLease(job, input);
  const result = await tx.naverDraftJob.updateMany({
    where: {
      id: job.id,
      status: job.status,
      claimedBy: input.claimedBy,
      claimedAt: leaseClaimedAt,
      updatedAt: job.updatedAt,
    },
    data,
  });
  if (result.count !== 1) throw new Error("NAVER_DRAFT_JOB_STALE_STATE");
  const updated = await tx.naverDraftJob.findUnique({ where: { id: job.id } });
  if (!updated) throw new Error("NAVER_DRAFT_JOB_NOT_FOUND");
  return updated;
}

async function clearNaverAuthHold(
  tx: Prisma.TransactionClient,
  expectedJobId: string | null,
  reason: string,
) {
  const event = await tx.eventLog.findUnique({ where: { id: NAVER_AUTH_HOLD_EVENT_ID } });
  if (!event) return false;
  const snapshot = parseNaverAuthHoldSnapshot(event.payload);
  if (!snapshot.active || (expectedJobId && snapshot.jobId !== expectedJobId)) return false;
  await tx.eventLog.update({
    where: { id: NAVER_AUTH_HOLD_EVENT_ID },
    data: {
      timestamp: new Date(),
      summary: "네이버 인증 보류가 해제되었습니다.",
      payload: {
        ...safeRetryEventPayload(event.payload),
        active: false,
        clearedAt: new Date().toISOString(),
        clearReason: reason,
      } as Prisma.InputJsonObject,
    },
  });
  return true;
}

async function assertNaverAuthHoldAllowsProgress(
  tx: Prisma.TransactionClient,
  job: Pick<NaverDraftJob, "id" | "status">,
  nextStatus: string,
) {
  const event = await tx.eventLog.findUnique({ where: { id: NAVER_AUTH_HOLD_EVENT_ID } });
  const snapshot = parseNaverAuthHoldSnapshot(event?.payload);
  if (!isNaverAuthHoldProgressAllowed({
    active: snapshot.active,
    holdJobId: snapshot.jobId,
    jobId: job.id,
    currentStatus: job.status,
    nextStatus,
  })) {
    throw new Error("NAVER_AUTH_HOLD_READY_REQUIRED");
  }
}

async function scheduleNaverAuthHold(
  job: NaverDraftJob,
  input: Pick<StatusReportInput, "status" | "claimedBy" | "leaseClaimedAt" | "errorCode" | "errorMessage" | "externalUrl">,
) {
  const now = new Date();
  const retryAfter = new Date(now.getTime() + getNaverAuthHoldCooldownMs(process.env.NAVER_AUTH_HOLD_COOLDOWN_SECONDS));
  return withNaverSerializableTransaction(async (tx) => {
    const current = await tx.naverDraftJob.findUnique({ where: { id: job.id } });
    if (!current) throw new Error("NAVER_DRAFT_JOB_NOT_FOUND");
    assertOwnedNaverLease(current, input);
    if (isNaverDraftTerminalStatus(current.status)) throw new Error("NAVER_DRAFT_TERMINAL_STATE_IMMUTABLE");
    if (!isAllowedNaverAgentTransition(current.status, input.status)) {
      throw new Error(`NAVER_DRAFT_INVALID_STATE_TRANSITION:${current.status}->${input.status}`);
    }
    if (!reclaimablePrePublishStatuses.includes(current.status) || current.publishAttemptCount !== 0) {
      throw new Error("NAVER_AUTH_HOLD_JOB_NOT_REQUEUEABLE");
    }
    const existing = await tx.eventLog.findUnique({ where: { id: NAVER_AUTH_HOLD_EVENT_ID } });
    const previous = parseNaverAuthHoldSnapshot(existing?.payload);
    const preserveExistingHold = previous.active && previous.jobId !== current.id;
    const probeCount = previous.active && previous.jobId === current.id ? previous.probeCount + 1 : 1;
    const updated = await updateOwnedNaverJob(tx, current, input, {
      status: "queued",
      claimedBy: null,
      claimedAt: null,
      startedAt: null,
      completedAt: null,
      externalUrl: input.externalUrl,
      errorCode: input.errorCode ?? "NAVER_LOGIN_OR_SECURITY_REQUIRED",
      errorMessage: input.errorMessage,
    });
    if (preserveExistingHold) return updated;
    const payload = {
      active: true,
      jobId: current.id,
      publishKey: current.publishKey,
      status: input.status,
      heldAt: now.toISOString(),
      retryAfter: retryAfter.toISOString(),
      probeCount,
      readyProbeCount: 0,
      lastReadyProbeAt: null,
      readyProbeLeaseClaimedAt: null,
    } as Prisma.InputJsonObject;
    await tx.eventLog.upsert({
      where: { id: NAVER_AUTH_HOLD_EVENT_ID },
      create: {
        id: NAVER_AUTH_HOLD_EVENT_ID,
        type: "NaverPublisherAuthHold",
        timestamp: now,
        summary: "네이버 로그인 또는 보안 확인이 필요해 발행기만 일시 중지되었습니다.",
        payload,
      },
      update: {
        timestamp: now,
        summary: "네이버 로그인 또는 보안 확인이 필요해 발행기만 일시 중지되었습니다.",
        payload,
      },
    });
    return updated;
  });
}

async function reportNaverSessionReady(job: NaverDraftJob, input: StatusReportInput) {
  return withNaverSerializableTransaction(async (tx) => {
    const current = await tx.naverDraftJob.findUnique({ where: { id: job.id } });
    if (!current) throw new Error("NAVER_DRAFT_JOB_NOT_FOUND");
    assertOwnedNaverLease(current, input);
    if (current.status !== "in_progress") throw new Error("NAVER_SESSION_READY_INVALID_STATE");
    const now = new Date();
    const updated = await updateOwnedNaverJob(tx, current, input, {
      status: "in_progress",
      startedAt: current.startedAt ?? now,
      completedAt: null,
      errorCode: null,
      errorMessage: null,
    });
    const authEvent = await tx.eventLog.findUnique({ where: { id: NAVER_AUTH_HOLD_EVENT_ID } });
    const snapshot = parseNaverAuthHoldSnapshot(authEvent?.payload);
    if (!snapshot.active) return updated;
    if (snapshot.jobId !== current.id || !authEvent) throw new Error("NAVER_SESSION_READY_HOLD_MISMATCH");
    const leaseClaimedAt = current.claimedAt?.toISOString() ?? null;
    if (!leaseClaimedAt) throw new Error("NAVER_DRAFT_LEASE_REQUIRED");
    const probe = evaluateNaverSessionReadyProbe({
      previousCount: snapshot.readyProbeCount,
      previousAt: snapshot.lastReadyProbeAt,
      previousLeaseClaimedAt: snapshot.readyProbeLeaseClaimedAt,
      leaseClaimedAt,
      nowMs: now.getTime(),
    });
    if (probe.ready) {
      await clearNaverAuthHold(tx, current.id, "NAVER_SESSION_READY_CONFIRMED_TWICE");
      return updated;
    }
    if (snapshot.readyProbeLeaseClaimedAt !== leaseClaimedAt || probe.nextCount !== snapshot.readyProbeCount) {
      await tx.eventLog.update({
        where: { id: NAVER_AUTH_HOLD_EVENT_ID },
        data: {
          timestamp: now,
          summary: "네이버 인증 정상 여부를 연속 확인하고 있습니다.",
          payload: {
            ...safeRetryEventPayload(authEvent.payload),
            readyProbeCount: probe.nextCount,
            lastReadyProbeAt: now.toISOString(),
            readyProbeLeaseClaimedAt: leaseClaimedAt,
          } as Prisma.InputJsonObject,
        },
      });
    }
    return updated;
  });
}

async function scheduleSafeNaverDraftRetry(
  job: NaverDraftJob,
  input: Pick<StatusReportInput, "status" | "claimedBy" | "leaseClaimedAt" | "errorCode" | "errorMessage">,
) {
  const eventId = `event-naver-safe-retry-${job.id}`;
  return withNaverSerializableTransaction(async (tx) => {
    const current = await tx.naverDraftJob.findUnique({ where: { id: job.id } });
    if (!current) throw new Error("NAVER_DRAFT_JOB_NOT_FOUND");
    assertOwnedNaverLease(current, input);
    if (isNaverDraftTerminalStatus(current.status)) throw new Error("NAVER_DRAFT_TERMINAL_STATE_IMMUTABLE");
    if (!isAllowedNaverAgentTransition(current.status, input.status)) {
      throw new Error(`NAVER_DRAFT_INVALID_STATE_TRANSITION:${current.status}->${input.status}`);
    }
    await assertNaverAuthHoldAllowsProgress(tx, current, input.status);
    const existing = await tx.eventLog.findUnique({ where: { id: eventId } });
    const payload = safeRetryEventPayload(existing?.payload);
    const retryCount = typeof payload.retryCount === "number" ? payload.retryCount : 0;
    const decision = evaluateNaverDraftSafeRetry({
      status: input.status,
      allowPublish: current.allowPublish,
      publishAttemptCount: current.publishAttemptCount,
      retryCount,
      retryLimit: getNaverDraftSafeRetryLimit(process.env.NAVER_DRAFT_SAFE_RETRY_LIMIT),
      errorCode: input.errorCode,
      errorMessage: input.errorMessage,
    });
    if (!decision.allowed) return null;
    const now = new Date();
    const updated = await updateOwnedNaverJob(tx, current, input, {
      status: "queued",
      claimedBy: null,
      claimedAt: null,
      startedAt: null,
      completedAt: null,
      errorCode: input.errorCode,
      errorMessage: input.errorMessage,
    });
    await tx.eventLog.upsert({
      where: { id: eventId },
      create: {
        id: eventId,
        type: "NaverDraftSafeRetryScheduled",
        timestamp: now,
        summary: `네이버 발행 전 오류 자동 재시도 ${decision.nextRetryCount}회차 예약`,
        payload: {
          jobId: job.id,
          retryCount: decision.nextRetryCount,
          previousStatus: input.status,
          errorCode: input.errorCode ?? null,
        },
      },
      update: {
        timestamp: now,
        summary: `네이버 발행 전 오류 자동 재시도 ${decision.nextRetryCount}회차 예약`,
        payload: {
          jobId: job.id,
          retryCount: decision.nextRetryCount,
          previousStatus: input.status,
          errorCode: input.errorCode ?? null,
        },
      },
    });
    return updated;
  });
}

async function expireLateNaverDraftJob(job: NaverDraftJob, now: Date) {
  if (!isNaverDraftScheduleExpired(job, now)) return false;
  const result = await prisma.naverDraftJob.updateMany({
    where: {
      id: job.id,
      status: job.status,
      claimedBy: job.claimedBy,
      claimedAt: job.claimedAt,
      updatedAt: job.updatedAt,
    },
    data: {
      status: "failed",
      claimedBy: null,
      claimedAt: null,
      completedAt: now,
      errorCode: "NAVER_SCHEDULE_EXPIRED",
      errorMessage: "The scheduled publishing window expired before the job could be safely leased.",
    },
  });
  return result.count === 1;
}

export async function getNextNaverDraftJob() {
  const staleBefore = maxClaimAgeDate();
  const now = new Date();
  let publishCircuit = await getPublishCircuitBreaker();
  let activePublishing = await prisma.naverDraftJob.findFirst({
    where: { allowPublish: true, status: "publishing" },
    orderBy: { updatedAt: "asc" },
  });
  if (activePublishing && isNaverPublishingStale(
    activePublishing.updatedAt,
    now,
    process.env.NAVER_PUBLISHING_STALE_SECONDS,
  )) {
    const activated = await activateStalePublishingCircuitBreaker(activePublishing);
    publishCircuit = await getPublishCircuitBreaker();
    if (!activated) {
      activePublishing = await prisma.naverDraftJob.findFirst({
        where: { allowPublish: true, status: "publishing" },
        orderBy: { updatedAt: "asc" },
      });
    }
  }
  const autoPublishLeaseBlocked = publishCircuit.active || Boolean(activePublishing);
  const authHoldEvent = await prisma.eventLog.findUnique({ where: { id: NAVER_AUTH_HOLD_EVENT_ID } });
  const authHold = parseNaverAuthHoldSnapshot(authHoldEvent?.payload);
  if (authHold.active) {
    const heldJob = authHold.jobId
      ? await prisma.naverDraftJob.findUnique({ where: { id: authHold.jobId } })
      : null;
    const decision = evaluateNaverAuthHold({
      snapshot: authHold,
      nowMs: now.getTime(),
      heldJob: heldJob ? {
        id: heldJob.id,
        status: heldJob.status,
        publishAttemptCount: heldJob.publishAttemptCount,
        claimable: isClaimableNaverJob(heldJob, staleBefore) && isNaverDraftClaimDue(heldJob, now),
      } : null,
    });
    if (decision.action === "wait") return null;
    if (decision.action === "probe" && heldJob) {
      if (await expireLateNaverDraftJob(heldJob, now)) return null;
      if (autoPublishLeaseBlocked && heldJob.allowPublish) return null;
      return serializeNaverDraftJobWithPipeline(heldJob);
    }
    if (decision.action === "clear") {
      await withNaverSerializableTransaction((tx) => clearNaverAuthHold(tx, authHold.jobId, decision.reason));
    }
  }
  const candidates = await prisma.naverDraftJob.findMany({
    where: {
      ...(autoPublishLeaseBlocked ? { allowPublish: false } : {}),
      OR: [
        { status: "queued" },
        { allowPublish: true, status: { in: reclaimablePrePublishStatuses }, updatedAt: { lt: staleBefore } },
      ],
    },
    orderBy: { createdAt: "asc" },
    take: 50,
  });
  for (const candidate of candidates) {
    if (await expireLateNaverDraftJob(candidate, now)) continue;
    if (isNaverDraftClaimDue(candidate, now)) return serializeNaverDraftJobWithPipeline(candidate);
  }
  return null;
}

export async function claimNaverDraftJob(jobId: string, claimedBy: string) {
  const now = new Date();
  const staleBefore = maxClaimAgeDate();
  const claimed = await withNaverSerializableTransaction(async (tx) => {
    const current = await tx.naverDraftJob.findUnique({ where: { id: jobId } });
    if (!current || !isClaimableNaverJob(current, staleBefore)) return null;
    if (isNaverDraftScheduleExpired(current, now)) {
      await tx.naverDraftJob.updateMany({
        where: {
          id: current.id,
          status: current.status,
          claimedBy: current.claimedBy,
          claimedAt: current.claimedAt,
          updatedAt: current.updatedAt,
        },
        data: {
          status: "failed",
          claimedBy: null,
          claimedAt: null,
          completedAt: now,
          errorCode: "NAVER_SCHEDULE_EXPIRED",
          errorMessage: "The scheduled publishing window expired before the job could be safely claimed.",
        },
      });
      return null;
    }
    if (!isNaverDraftClaimDue(current, now)) return null;
    if (current.allowPublish) {
      const circuit = await tx.eventLog.findUnique({ where: { id: PUBLISH_CIRCUIT_BREAKER_EVENT_ID } });
      const payload = circuit && typeof circuit.payload === "object" && !Array.isArray(circuit.payload)
        ? circuit.payload as Record<string, Prisma.JsonValue>
        : {};
      if (payload.active === true) return null;
      const publishing = await tx.naverDraftJob.findFirst({
        where: { id: { not: current.id }, allowPublish: true, status: "publishing" },
        select: { id: true },
      });
      if (publishing) return null;
    }
    const authHoldEvent = await tx.eventLog.findUnique({ where: { id: NAVER_AUTH_HOLD_EVENT_ID } });
    const authHold = parseNaverAuthHoldSnapshot(authHoldEvent?.payload);
    if (authHold.active) {
      const heldJob = authHold.jobId
        ? await tx.naverDraftJob.findUnique({ where: { id: authHold.jobId } })
        : null;
      const decision = evaluateNaverAuthHold({
        snapshot: authHold,
        nowMs: now.getTime(),
        heldJob: heldJob ? {
          id: heldJob.id,
          status: heldJob.status,
          publishAttemptCount: heldJob.publishAttemptCount,
          claimable: isClaimableNaverJob(heldJob, staleBefore) && isNaverDraftClaimDue(heldJob, now),
        } : null,
      });
      if (decision.action === "clear") {
        await clearNaverAuthHold(tx, authHold.jobId, decision.reason);
      } else if (decision.action !== "probe" || decision.jobId !== jobId) {
        return null;
      }
    }
    const updated = await tx.naverDraftJob.updateMany({
      where: {
        id: jobId,
        status: current.status,
        claimedBy: current.claimedBy,
        claimedAt: current.claimedAt,
        updatedAt: current.updatedAt,
        OR: [
          { status: "queued" },
          { allowPublish: true, status: { in: reclaimablePrePublishStatuses }, updatedAt: { lt: staleBefore } },
        ],
      },
      data: { status: "claimed", claimedBy, claimedAt: now, errorCode: null, errorMessage: null },
    });
    if (updated.count === 0) return null;
    return tx.naverDraftJob.findUnique({ where: { id: jobId } });
  });
  return claimed ? serializeNaverDraftJobWithPipeline(claimed) : null;
}

function parseNonNegativeInt(value: string | undefined, fallback: number) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function isAllowedPublishedReport(input: Pick<StatusReportInput, "publishedUrl" | "naverPostId">) {
  return isAllowedNaverPublishedResult({
    url: input.publishedUrl,
    reportedPostId: input.naverPostId,
    expectedBlogId: process.env.NAVER_BLOG_ID?.trim() || "bgmarketnote",
  });
}

function isIdempotentTerminalNaverReport(job: NaverDraftJob, input: StatusReportInput) {
  if (job.status !== input.status) return false;
  if (job.status !== "published") return true;
  return isAllowedPublishedReport(input)
    && isAllowedNaverPublishedResult({
      url: job.publishedUrl ?? undefined,
      reportedPostId: job.naverPostId ?? undefined,
      expectedBlogId: process.env.NAVER_BLOG_ID?.trim() || "bgmarketnote",
    })
    && input.naverPostId?.trim() === job.naverPostId;
}

function assertNaverPublishReady(
  job: NaverDraftJob,
  input: Pick<StatusReportInput, "claimedBy" | "leaseClaimedAt">,
) {
  assertOwnedNaverLease(job, input);
  if (isNaverDraftTerminalStatus(job.status)) throw new Error("NAVER_DRAFT_TERMINAL_STATE_IMMUTABLE");
  if (job.status !== "publish_ready" || !job.allowPublish) throw new Error("NAVER_PUBLISH_NOT_ALLOWED");
}

async function beginNaverPublish(jobId: string, input: StatusReportInput) {
  const current = await prisma.naverDraftJob.findUnique({ where: { id: jobId } });
  if (!current) throw new Error("NAVER_DRAFT_JOB_NOT_FOUND");
  assertOwnedNaverLease(current, input);
  if (current.status === "publishing") return current;
  if (isNaverDraftTerminalStatus(current.status)) throw new Error("NAVER_DRAFT_TERMINAL_STATE_IMMUTABLE");
  if (current.status !== "publish_ready" || !current.allowPublish) throw new Error("NAVER_PUBLISH_NOT_ALLOWED");
  if (isNaverDraftScheduleExpired(current)) {
    return withNaverSerializableTransaction(async (tx) => {
      const fresh = await tx.naverDraftJob.findUnique({ where: { id: current.id } });
      if (!fresh) throw new Error("NAVER_DRAFT_JOB_NOT_FOUND");
      assertOwnedNaverLease(fresh, input);
      if (fresh.status === "publishing") return fresh;
      assertNaverPublishReady(fresh, input);
      if (!isNaverDraftScheduleExpired(fresh)) throw new Error("NAVER_DRAFT_JOB_STALE_STATE");
      return updateOwnedNaverJob(tx, fresh, input, {
        status: "failed",
        claimedBy: null,
        claimedAt: null,
        completedAt: new Date(),
        errorCode: "NAVER_SCHEDULE_EXPIRED",
        errorMessage: "The scheduled publishing window expired before publishing began.",
      });
    });
  }
  if (!isNaverDraftPublishDue(current)) return current;
  const detail = current.contentPipelineId ? await getContentPipelineDetail(current.contentPipelineId) : null;
  const reasons = detail?.pipeline
    ? automaticPublishBlockReasons(detail.pipeline, current.body)
    : ["ContentPipeline 최신 상태 확인 필요"];
  if (reasons.length > 0) {
    return withNaverSerializableTransaction(async (tx) => {
      const fresh = await tx.naverDraftJob.findUnique({ where: { id: current.id } });
      if (!fresh) throw new Error("NAVER_DRAFT_JOB_NOT_FOUND");
      assertOwnedNaverLease(fresh, input);
      if (fresh.status === "publishing") return fresh;
      assertNaverPublishReady(fresh, input);
      return updateOwnedNaverJob(tx, fresh, input, {
        status: "publish_blocked",
        completedAt: new Date(),
        errorCode: "NAVER_FINAL_QUALITY_GATE_BLOCKED",
        errorMessage: reasons.join("; ").slice(0, 1800),
      });
    });
  }
  return withNaverSerializableTransaction(async (tx) => {
    const job = await tx.naverDraftJob.findUnique({ where: { id: jobId } });
    if (!job) throw new Error("NAVER_DRAFT_JOB_NOT_FOUND");
    assertOwnedNaverLease(job, input);
    if (job.status === "publishing") return job;
    assertNaverPublishReady(job, input);
    if (isNaverDraftScheduleExpired(job)) {
      return updateOwnedNaverJob(tx, job, input, {
        status: "failed",
        claimedBy: null,
        claimedAt: null,
        completedAt: new Date(),
        errorCode: "NAVER_SCHEDULE_EXPIRED",
        errorMessage: "The scheduled publishing window expired before publishing began.",
      });
    }
    if (!isNaverDraftPublishDue(job)) return job;
    await assertNaverAuthHoldAllowsProgress(tx, job, "publishing");
    if (process.env.STOCK_BLOG_SCHEDULER_AUTO_PUBLISH !== "true") {
      return updateOwnedNaverJob(tx, job, input, {
        status: "publish_blocked", completedAt: new Date(), errorCode: "NAVER_SERVER_AUTO_PUBLISH_DISABLED", errorMessage: "Server auto publish is disabled.",
      });
    }
    const firstPublishAt = Date.parse(process.env.STOCK_BLOG_FIRST_AUTO_PUBLISH_AT ?? "");
    if (Number.isFinite(firstPublishAt) && Date.now() < firstPublishAt) {
      return job;
    }
    const circuit = await tx.eventLog.findUnique({ where: { id: PUBLISH_CIRCUIT_BREAKER_EVENT_ID } });
    const circuitPayload = circuit && typeof circuit.payload === "object" && !Array.isArray(circuit.payload)
      ? circuit.payload as Record<string, Prisma.JsonValue>
      : {};
    if (circuitPayload.active === true) {
      // Hold the already-assembled job at the publish gate. Once operations
      // clears the account-level circuit, the stale lease can be reclaimed and
      // the same idempotent job resumes without rebuilding or becoming terminal.
      return {
        ...job,
        status: "publish_ready" as const,
        errorCode: "NAVER_PUBLISH_CIRCUIT_BREAKER_ACTIVE",
        errorMessage: "Automatic publish circuit breaker is active.",
      };
    }
    const otherPublishing = await tx.naverDraftJob.findFirst({
      where: { id: { not: job.id }, allowPublish: true, status: "publishing" },
      select: { id: true },
    });
    if (otherPublishing) return job;
    const canaryLimit = Math.max(1, parseNonNegativeInt(process.env.STOCK_BLOG_AUTO_PUBLISH_CANARY_LIMIT, 1));
    const publishedCount = await tx.naverDraftJob.count({ where: { allowPublish: true, status: "published" } });
    if (publishedCount >= canaryLimit) {
      return updateOwnedNaverJob(tx, job, input, {
        status: "publish_blocked", completedAt: new Date(), errorCode: "NAVER_PUBLISH_CANARY_LIMIT_REACHED", errorMessage: "Automatic publish canary limit reached.",
      });
    }
    const duplicate = await tx.naverDraftJob.findFirst({
      where: {
        id: { not: job.id },
        status: "published",
        OR: [
          ...(job.publishKey ? [{ publishKey: job.publishKey }] : []),
          ...(job.contentPipelineId ? [{ contentPipelineId: job.contentPipelineId }] : []),
          ...(job.marketDate ? [{ title: job.title, marketDate: job.marketDate }] : []),
        ],
      },
    });
    if (duplicate || job.publishAttemptCount > parseNonNegativeInt(process.env.STOCK_BLOG_AUTO_PUBLISH_RETRY_LIMIT, 0)) {
      return updateOwnedNaverJob(tx, job, input, {
        status: "duplicate_blocked", completedAt: new Date(), errorCode: "NAVER_DUPLICATE_PUBLISH_BLOCKED", errorMessage: "Duplicate or repeated publish attempt was blocked.",
      });
    }
    return updateOwnedNaverJob(tx, job, input, {
      status: "publishing",
      publishAttemptCount: { increment: 1 },
      errorCode: null,
      errorMessage: null,
    });
  });
}

export async function reportNaverDraftJobStatus(jobId: string, input: StatusReportInput) {
  if (input.status === "publishing") {
    return serializeNaverDraftJobWithPipeline(await beginNaverPublish(jobId, input));
  }
  const now = new Date();
  const normalizedNaverPostId = input.naverPostId?.trim();
  const current = await prisma.naverDraftJob.findUnique({ where: { id: jobId } });
  if (!current) throw new Error("NAVER_DRAFT_JOB_NOT_FOUND");
  if (current.errorCode === "NAVER_SCHEDULE_EXPIRED") {
    return serializeNaverDraftJobWithPipeline(current);
  }
  if (isNaverDraftTerminalStatus(current.status)) {
    assertOwnedNaverLease(current, input);
    if (isIdempotentTerminalNaverReport(current, input)) {
      return serializeNaverDraftJobWithPipeline(current);
    }
    throw new Error("NAVER_DRAFT_TERMINAL_STATE_IMMUTABLE");
  }
  assertOwnedNaverLease(current, input);
  if (isNaverSessionReadyProgress(input)) {
    return serializeNaverDraftJobWithPipeline(await reportNaverSessionReady(current, input));
  }
  if (input.status === "published" && (current.status !== "publishing" || !isAllowedPublishedReport(input))) {
    throw new Error("NAVER_PUBLISHED_RESULT_INVALID");
  }
  if (current.status === "publishing" && input.status !== "published" && input.status !== "publish_failed") {
    const unsafe = await withNaverSerializableTransaction(async (tx) => {
      const fresh = await tx.naverDraftJob.findUnique({ where: { id: current.id } });
      if (!fresh) throw new Error("NAVER_DRAFT_JOB_NOT_FOUND");
      assertOwnedNaverLease(fresh, input);
      if (fresh.status === "publish_failed") return fresh;
      if (isNaverDraftTerminalStatus(fresh.status)) throw new Error("NAVER_DRAFT_TERMINAL_STATE_IMMUTABLE");
      if (fresh.status !== "publishing") throw new Error("NAVER_DRAFT_JOB_STALE_STATE");
      const updated = await updateOwnedNaverJob(tx, fresh, input, {
        status: "publish_failed",
        completedAt: now,
        errorCode: "NAVER_PUBLISH_RESULT_UNCERTAIN",
        errorMessage: input.errorMessage ?? `Unexpected ${input.status} report arrived after publishing began.`,
      });
      await activatePublishCircuitBreaker(tx, updated, "publish_failed", updated.errorMessage ?? undefined);
      return updated;
    });
    return serializeNaverDraftJobWithPipeline(unsafe);
  }
  if (isNaverAuthHoldStatus(input.status)) {
    if (canRequeueNaverAuthHoldJob(current.publishAttemptCount)) {
      return serializeNaverDraftJobWithPipeline(await scheduleNaverAuthHold(current, input));
    }
    const unsafe = await withNaverSerializableTransaction(async (tx) => {
      const fresh = await tx.naverDraftJob.findUnique({ where: { id: current.id } });
      if (!fresh) throw new Error("NAVER_DRAFT_JOB_NOT_FOUND");
      assertOwnedNaverLease(fresh, input);
      if (fresh.status === "publish_failed") return fresh;
      if (isNaverDraftTerminalStatus(fresh.status)) throw new Error("NAVER_DRAFT_TERMINAL_STATE_IMMUTABLE");
      if (fresh.status !== "publishing" || fresh.publishAttemptCount === 0) {
        throw new Error("NAVER_DRAFT_JOB_STALE_STATE");
      }
      const updated = await updateOwnedNaverJob(tx, fresh, input, {
        status: "publish_failed",
        completedAt: now,
        errorCode: "NAVER_AUTH_AFTER_PUBLISH_ATTEMPT",
        errorMessage: input.errorMessage ?? "Authentication changed after publishing began; manual duplicate review is required.",
      });
      await activatePublishCircuitBreaker(tx, updated, "publish_failed", updated.errorMessage ?? undefined);
      return updated;
    });
    return serializeNaverDraftJobWithPipeline(unsafe);
  }
  if (!isAllowedNaverAgentTransition(current.status, input.status)) {
    throw new Error(`NAVER_DRAFT_INVALID_STATE_TRANSITION:${current.status}->${input.status}`);
  }
  const safeRetry = await scheduleSafeNaverDraftRetry(current, input);
  if (safeRetry) return serializeNaverDraftJobWithPipeline(safeRetry);
  const data: Prisma.NaverDraftJobUpdateManyMutationInput = {
    status: input.status,
    externalUrl: input.externalUrl,
    errorCode: input.errorCode,
    errorMessage: input.errorMessage,
  };
  if (input.status === "in_progress") data.startedAt = current.startedAt ?? now;
  if (input.status === "published") {
    data.publishedAt = now;
    data.publishedUrl = input.publishedUrl;
    data.externalUrl = input.publishedUrl;
    data.naverPostId = normalizedNaverPostId;
    data.publishMethod = "local-agent";
  }
  if (["draft_saved", "published", "user_publish_required", "completed", "failed", "login_required", "captcha_required", "security_check_required", "readability_failed", "image_upload_failed", "image_quality_failed", "draft_save_failed", "publish_blocked", "publish_failed", "duplicate_blocked", "quality_failed", "reference_failed", "market_data_failed", "cancelled"].includes(input.status)) data.completedAt = now;
  const job = await withNaverSerializableTransaction(async (tx) => {
    const fresh = await tx.naverDraftJob.findUnique({ where: { id: current.id } });
    if (!fresh) throw new Error("NAVER_DRAFT_JOB_NOT_FOUND");
    assertOwnedNaverLease(fresh, input);
    if (isNaverDraftTerminalStatus(fresh.status)) {
      if (isIdempotentTerminalNaverReport(fresh, input)) return fresh;
      throw new Error("NAVER_DRAFT_TERMINAL_STATE_IMMUTABLE");
    }
    if (!isAllowedNaverAgentTransition(fresh.status, input.status)) {
      throw new Error(`NAVER_DRAFT_INVALID_STATE_TRANSITION:${fresh.status}->${input.status}`);
    }
    await assertNaverAuthHoldAllowsProgress(tx, fresh, input.status);
    if (input.status === "published") {
      const duplicatePost = await tx.naverDraftJob.findFirst({
        where: {
          id: { not: fresh.id },
          status: "published",
          naverPostId: normalizedNaverPostId,
        },
        select: { id: true },
      });
      if (duplicatePost) {
        const failed = await updateOwnedNaverJob(tx, fresh, input, {
          status: "publish_failed",
          completedAt: now,
          errorCode: "NAVER_PUBLISHED_POST_ID_ALREADY_RECORDED",
          errorMessage: `Naver post ${normalizedNaverPostId} is already assigned to job ${duplicatePost.id}; manual duplicate review is required.`,
        });
        await activatePublishCircuitBreaker(tx, failed, "publish_failed", failed.errorMessage ?? undefined);
        return failed;
      }
    }
    const updated = await updateOwnedNaverJob(tx, fresh, input, data);
    if (input.status === "published") await clearResolvedPublishingCircuitBreaker(tx, updated.id);
    await activatePublishCircuitBreaker(tx, updated, input.status, input.errorMessage ?? input.errorCode);
    return updated;
  });
  return serializeNaverDraftJobWithPipeline(job);
}

export function getNaverDraftAgentKeyConfigured() {
  return Boolean(process.env.NAVER_DRAFT_AGENT_KEY?.trim());
}

export function verifyNaverDraftAgentKey(value: string | null) {
  const expected = process.env.NAVER_DRAFT_AGENT_KEY?.trim();
  if (!expected || !value) return false;
  const a = Buffer.from(value);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
