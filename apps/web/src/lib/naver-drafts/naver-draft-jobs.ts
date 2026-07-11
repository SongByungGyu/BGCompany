import { randomUUID, timingSafeEqual } from "node:crypto";
import type { NaverDraftJob, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getContentPipelineDetail } from "@/lib/content-pipeline/content-pipeline-service";
import type { ContentPipelineRun, StockBriefingTemplate } from "@/features/content-pipeline/content-pipeline-types";
import type { CompetitorBlogReference, ReferenceBundle, ReferenceItem } from "@/lib/stock-blog/references/reference-types";
import { buildStockBlogThumbnail, inferStockBriefingTemplateFromPipeline } from "@/lib/stock-blog/thumbnail-automation";
import { evaluateStockBlogPublishQuality, getRealStockReferences } from "@/lib/stock-blog/quality-gate";
import { renderNaverBody, type NaverBodyBlock } from "@/lib/stock-blog/naver-body";

export type NaverDraftJobStatus =
  | "created"
  | "queued"
  | "claimed"
  | "in_progress"
  | "draft_saved"
  | "user_publish_required"
  | "completed"
  | "failed"
  | "login_required"
  | "captcha_required"
  | "security_check_required"
  | "readability_failed"
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
  references: ReferenceItem[];
  competitorBlogReferences: CompetitorBlogReference[];
  allowImageUpload: boolean;
  disclaimer: string | null;
  externalUrl: string | null;
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
  errorCode?: string;
  errorMessage?: string;
};

type DraftQualityCheck = {
  ok: boolean;
  code?: "NAVER_DRAFT_QUALITY_FAILED" | "NAVER_DRAFT_NEEDS_REFERENCE";
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

const activeStatuses = ["queued", "claimed", "in_progress", "draft_saved", "user_publish_required"];

const INVESTMENT_DISCLAIMER = "본 글은 투자 참고용 정보이며, 특정 종목의 매수·매도 추천이 아닙니다. 모든 투자 판단과 책임은 투자자 본인에게 있습니다.";

const WEEKEND_FORBIDDEN_PHRASES = ["장전 브리핑", "장마감", "장 마감", "오늘 장 초반", "장 시작 전", "금일 장중", "장중 대응"];

const STOCK_BRIEFING_COPY: Record<StockBriefingTemplate, {
  fallbackTitle: string;
  category: string;
  introHeading: string;
  headings: string[];
  requiredTags: string[];
  preferredImagePlacement: string;
}> = {
  KOREA_DAILY_PREVIEW: {
    fallbackTitle: "오늘의 한국 증시 장전 브리핑",
    category: "주식시장 브리핑",
    introHeading: "① 오늘 장을 보기 전 한 줄 요약",
    headings: [
      "② 전일 해외시장과 오늘 한국장 연결고리",
      "③ 수급·환율·금리 체크",
      "④ 주목할 섹터와 테마",
      "⑤ 오늘 투자자 체크리스트",
      "⑥ 참고자료와 해석",
    ],
    requiredTags: ["한국증시", "장전브리핑", "코스피", "코스닥", "시장체크"],
    preferredImagePlacement: "본문 상단: 오늘 체크포인트 카드형 이미지",
  },
  KOREA_MARKET_CLOSE_US_PREVIEW: {
    fallbackTitle: "오늘 한국 증시 마감 정리와 미국장 체크포인트",
    category: "주식시장 브리핑",
    introHeading: "① 오늘 한국장 마감 한 줄 요약",
    headings: [
      "② 코스피·코스닥 흐름",
      "③ 수급과 섹터별 온도차",
      "④ 오늘 밤 미국장 체크포인트",
      "⑤ 내일 장을 위한 투자자 체크리스트",
      "⑥ 참고자료와 해석",
    ],
    requiredTags: ["한국장마감", "미국장", "수급", "섹터", "시장브리핑"],
    preferredImagePlacement: "본문 중단: 한국장 마감과 미국장 프리뷰를 나란히 보여주는 카드",
  },
  WEEKLY_MARKET_REVIEW: {
    fallbackTitle: "이번 주 한국·미국 증시 주간 정리",
    category: "주식시장 브리핑",
    introHeading: "① 이번 주 시장 한 줄 요약",
    headings: [
      "② 한국 증시 주간 흐름",
      "③ 미국 증시와 글로벌 변수",
      "④ 강했던 섹터와 약했던 섹터",
      "⑤ 다음 주로 이어질 체크포인트",
      "⑥ 참고자료와 해석",
    ],
    requiredTags: ["주간증시", "한국증시", "미국증시", "섹터정리", "다음주체크"],
    preferredImagePlacement: "본문 상단: 주간 시장 정리 썸네일과 핵심 지표 카드",
  },
  NEXT_WEEK_MARKET_PREVIEW: {
    fallbackTitle: "다음 주 증시 일정과 체크포인트",
    category: "주식시장 브리핑",
    introHeading: "① 다음 주 시장을 보기 전 한 줄 요약",
    headings: [
      "② 다음 주 주요 일정",
      "③ 한국 증시 체크포인트",
      "④ 미국 증시 체크포인트",
      "⑤ 리스크와 기회 요인",
      "⑥ 투자자 체크리스트",
      "⑦ 참고자료와 해석",
    ],
    requiredTags: ["다음주증시", "경제일정", "실적시즌", "투자체크리스트", "시장프리뷰"],
    preferredImagePlacement: "본문 상단: 다음 주 경제 일정 캘린더형 이미지",
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
  if (template !== "WEEKLY_MARKET_REVIEW" && template !== "NEXT_WEEK_MARKET_PREVIEW") return value;
  return WEEKEND_FORBIDDEN_PHRASES.reduce((text, phrase) => text.replaceAll(phrase, "시장 정리"), value);
}

function sectionsToText(pipeline: ContentPipelineRun) {
  const writer = pipeline.writerResult;
  if (!writer) return "";
  if (clean(writer.fullDraft)) return clean(writer.fullDraft);
  if (clean(writer.markdownDraft)) return clean(writer.markdownDraft);
  const sections = writer.sections?.map((section) => {
    const heading = clean(section.heading);
    const body = clean(section.body);
    if (heading && body) return `${heading}\n${body}`;
    return heading || body;
  }).filter(Boolean) ?? [];
  return [writer.introduction, ...sections, writer.conclusion, writer.cta]
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
      "오전 강세 섹터가 오후까지 유지되는지 확인",
    ];
  }
  if (template === "KOREA_MARKET_CLOSE_US_PREVIEW") {
    return [
      "한국장 마감 후 미국 선물과 금리 흐름 확인",
      "국내 장중 강했던 섹터가 미국장 테마와 연결되는지 확인",
      "환율 변화가 다음 거래일 외국인 수급에 부담이 될지 점검",
      "실적 발표 또는 경제지표 일정이 있는 종목은 변동성 확대 가능성 확인",
    ];
  }
  if (template === "NEXT_WEEK_MARKET_PREVIEW") {
    return [
      "다음 주 주요 경제지표 발표 일정 확인",
      "대형 기술주 실적 또는 가이던스 관련 이벤트 확인",
      "환율·금리 방향이 국내 수급에 미칠 영향 점검",
      "주도 섹터가 바뀌는지, 기존 강세 업종이 이어지는지 확인",
    ];
  }
  return [
    "이번 주 강했던 업종과 약했던 업종을 분리해서 복기",
    "외국인·기관 수급이 지수 상승을 뒷받침했는지 확인",
    "미국장 변수와 국내 섹터 흐름이 같은 방향이었는지 점검",
    "다음 주에도 이어질 이벤트와 소멸된 재료를 구분",
  ];
}

function buildPlainBody(pipeline: ContentPipelineRun, template: StockBriefingTemplate, title: string, refs: ReferenceItem[]) {
  const copy = STOCK_BRIEFING_COPY[template];
  const blocks: NaverBodyBlock[] = [
    { type: "heading", text: title },
    { type: "heading", text: copy.introHeading },
    { type: "intro", text: ensureMeaningfulParagraph(
      clean(pipeline.writerResult?.introduction) || clean(pipeline.outputSummary),
      `${pipeline.topic}을 중심으로 시장 흐름, 수급, 섹터, 이벤트를 블로그 독자가 바로 확인할 수 있게 정리했습니다.`,
    ) },
    ...copy.headings.slice(0, -1).flatMap<NaverBodyBlock>((heading, index) => [
      { type: "heading", text: heading },
      { type: "paragraph", text: buildSectionBody(pipeline, index, template) },
    ]),
    { type: "heading", text: "투자자 체크리스트" },
    { type: "bulletList", items: buildChecklist(template) },
    { type: "heading", text: copy.headings.at(-1) ?? "참고자료와 해석" },
    ...refs.slice(0, 5).map<NaverBodyBlock>((item, index) => ({ type: "reference", item, index: index + 1 })),
    { type: "heading", text: "마무리" },
    { type: "paragraph", text: clean(pipeline.writerResult?.conclusion) || "시장은 매일 다른 신호를 주지만, 중요한 것은 방향을 단정하기보다 확인할 변수를 근거별로 줄여가는 것입니다." },
    { type: "disclaimer", text: INVESTMENT_DISCLAIMER },
  ];
  return sanitizeByTemplate(renderNaverBody(blocks), template);
}

function buildMarkdownBody(title: string, body: string) {
  return `# ${title}\n\n${body}`;
}

function buildDraftQualityCheck(template: StockBriefingTemplate, body: string, refs: ReferenceItem[], pipeline: ContentPipelineRun): DraftQualityCheck {
  const gate = evaluateStockBlogPublishQuality({
    pipeline,
    referenceBundle: collectReferenceBundle(pipeline),
    pasteReadyBody: body,
    writerText: sectionsToText(pipeline),
    requireRealReferences: pipeline.runnerMode === "hermes",
  });
  const reasons = [...gate.reasons];
  if ((template === "WEEKLY_MARKET_REVIEW" || template === "NEXT_WEEK_MARKET_PREVIEW") && WEEKEND_FORBIDDEN_PHRASES.some((phrase) => body.includes(phrase))) {
    reasons.push("주말/주간 글에 장전·장마감 등 일일 브리핑 표현 포함");
  }
  if (reasons.length === 0) return { ok: true, reasons: [] };
  return {
    ok: false,
    code: gate.status === "needs_reference" || refs.length < 3 ? "NAVER_DRAFT_NEEDS_REFERENCE" : "NAVER_DRAFT_QUALITY_FAILED",
    reasons,
  };
}


function buildDraftFromPipeline(pipeline: ContentPipelineRun): DraftBuildResult {
  const template = pipeline.naverBlogPublishPrep?.briefingTemplate ?? inferStockBriefingTemplateFromPipeline(pipeline);
  const copy = STOCK_BRIEFING_COPY[template];
  const title = sanitizeByTemplate(
    clean(pipeline.writerResult?.finalTitle)
      || clean(pipeline.marketingResult?.recommendedTitle)
      || clean(pipeline.plannerResult?.title)
      || clean(pipeline.outputTitle)
      || clean(pipeline.title)
      || copy.fallbackTitle,
    template,
  );
  const thumbnail = pipeline.naverBlogPublishPrep ?? buildStockBlogThumbnail(pipeline, template);
  const thumbnailText = clean(thumbnail.thumbnailTitle) || clean(thumbnail.thumbnailPrimaryText) || `${title} 핵심 정리`;
  const thumbnailPrompt = clean(thumbnail.thumbnailPrompt) || `네이버 블로그 썸네일, 깔끔한 금융 리포트 스타일, 제목: ${title}, 핵심 문구: ${thumbnailText}`;
  const refs = collectReferences(pipeline);
  const body = buildPlainBody(pipeline, template, title, refs);
  const quality = buildDraftQualityCheck(template, body, refs, pipeline);
  if (!quality.ok) {
    throw new Error(`${quality.code ?? "NAVER_DRAFT_QUALITY_FAILED"}: ${quality.reasons.join(" · ")}`);
  }
  const tags = unique([
    ...(pipeline.writerResult?.usedSeoKeywords ?? []),
    ...(pipeline.marketingResult?.seoKeywords ?? []),
    ...(pipeline.plannerResult?.seoKeywords ?? []),
    ...(pipeline.naverBlogPublishPrep?.naverTags ?? []),
    ...copy.requiredTags,
    "BGMarketNote",
  ]).slice(0, 20);
  return {
    title,
    body,
    markdownBody: buildMarkdownBody(title, body),
    htmlBody: toHtml(body),
    tags,
    category: pipeline.naverBlogPublishPrep?.naverCategory ?? copy.category,
    thumbnailText,
    thumbnailPrompt,
    disclaimer: INVESTMENT_DISCLAIMER,
  };
}

export function serializeNaverDraftJob(job: NaverDraftJob): SerializedNaverDraftJob {
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
    references: [],
    competitorBlogReferences: [],
    allowImageUpload: false,
    disclaimer: job.disclaimer,
    externalUrl: job.externalUrl,
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

export async function createNaverDraftJobFromPipeline(input: { contentPipelineId: string; approvalId?: string | null }) {
  const detail = await getContentPipelineDetail(input.contentPipelineId);
  if (!detail) throw new Error("CONTENT_PIPELINE_NOT_FOUND");

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
  if (existing) return serializeNaverDraftJobWithPipeline(existing, detail.pipeline);

  const draft = buildDraftFromPipeline(detail.pipeline);
  const job = await prisma.naverDraftJob.create({
    data: {
      id: `naver-draft-${randomUUID()}`,
      contentPipelineId: detail.pipeline.id,
      approvalId,
      status: "queued",
      ...draft,
    },
  });
  return serializeNaverDraftJobWithPipeline(job, detail.pipeline);
}

export async function cancelNaverDraftJob(jobId: string) {
  const job = await prisma.naverDraftJob.findUnique({ where: { id: jobId } });
  if (!job) return null;
  if (["completed", "draft_saved"].includes(job.status)) throw new Error("NAVER_DRAFT_JOB_ALREADY_FINISHED");
  return serializeNaverDraftJobWithPipeline(await prisma.naverDraftJob.update({
    where: { id: jobId },
    data: { status: "cancelled", completedAt: new Date() },
  }));
}

function maxClaimAgeDate() {
  const minutes = Number(process.env.NAVER_DRAFT_MAX_CLAIM_MINUTES ?? "10");
  const safeMinutes = Number.isFinite(minutes) && minutes > 0 ? minutes : 10;
  return new Date(Date.now() - safeMinutes * 60 * 1000);
}

export async function getNextNaverDraftJob() {
  const staleBefore = maxClaimAgeDate();
  const job = await prisma.naverDraftJob.findFirst({
    where: {
      OR: [
        { status: "queued" },
        { status: { in: ["claimed", "in_progress"] }, claimedAt: { lt: staleBefore } },
      ],
    },
    orderBy: { createdAt: "asc" },
  });
  return job ? serializeNaverDraftJobWithPipeline(job) : null;
}

export async function claimNaverDraftJob(jobId: string, claimedBy: string) {
  const now = new Date();
  const staleBefore = maxClaimAgeDate();
  const updated = await prisma.naverDraftJob.updateMany({
    where: {
      id: jobId,
      OR: [
        { status: "queued" },
        { status: { in: ["claimed", "in_progress"] }, claimedAt: { lt: staleBefore } },
      ],
    },
    data: { status: "claimed", claimedBy, claimedAt: now, errorCode: null, errorMessage: null },
  });
  if (updated.count === 0) return null;
  return getNaverDraftJob(jobId);
}

export async function reportNaverDraftJobStatus(jobId: string, input: StatusReportInput) {
  const now = new Date();
  const data: Prisma.NaverDraftJobUpdateInput = {
    status: input.status,
    claimedBy: input.claimedBy,
    externalUrl: input.externalUrl,
    errorCode: input.errorCode,
    errorMessage: input.errorMessage,
  };
  if (input.status === "in_progress") data.startedAt = now;
  if (["draft_saved", "user_publish_required", "completed", "failed", "login_required", "captcha_required", "security_check_required", "readability_failed", "cancelled"].includes(input.status)) data.completedAt = now;
  const job = await prisma.naverDraftJob.update({ where: { id: jobId }, data });
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
