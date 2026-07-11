
import { randomUUID, timingSafeEqual } from "node:crypto";
import type { NaverDraftJob, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getContentPipelineDetail } from "@/lib/content-pipeline/content-pipeline-service";
import type { ContentPipelineRun } from "@/features/content-pipeline/content-pipeline-types";
import { buildStockBlogThumbnail } from "@/lib/stock-blog/thumbnail-automation";

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

const activeStatuses = ["queued", "claimed", "in_progress", "draft_saved", "user_publish_required"];

const INVESTMENT_DISCLAIMER = "본 글은 투자 참고용 정보이며, 특정 종목의 매수·매도 추천이 아닙니다. 모든 투자 판단과 책임은 투자자 본인에게 있습니다.";

function clean(value?: string | null) {
  return typeof value === "string" ? value.trim() : "";
}

function unique(items: Array<string | undefined | null>) {
  return Array.from(new Set(items.map((item) => clean(item)).filter(Boolean)));
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
    .map((paragraph) => `<p>${htmlEscape(paragraph).replaceAll("\n", "<br />")}</p>`)
    .join("\n");
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

function buildDraftFromPipeline(pipeline: ContentPipelineRun) {
  const title = clean(pipeline.writerResult?.finalTitle)
    || clean(pipeline.marketingResult?.recommendedTitle)
    || clean(pipeline.plannerResult?.title)
    || clean(pipeline.outputTitle)
    || pipeline.title;
  const bodyCore = sectionsToText(pipeline)
    || clean(pipeline.plannerResult?.content)
    || clean(pipeline.outputSummary)
    || `${pipeline.title}\n\n${pipeline.topic}`;
  const tags = unique([
    ...(pipeline.writerResult?.usedSeoKeywords ?? []),
    ...(pipeline.marketingResult?.seoKeywords ?? []),
    ...(pipeline.plannerResult?.seoKeywords ?? []),
    "주식시장",
    "시장브리핑",
    "BGMarketNote",
  ]).slice(0, 20);
  const thumbnail = pipeline.naverBlogPublishPrep ?? buildStockBlogThumbnail(pipeline);
  const thumbnailText = clean(thumbnail.thumbnailTitle) || clean(thumbnail.thumbnailPrimaryText) || `${title} 핵심 정리`;
  const thumbnailPrompt = clean(thumbnail.thumbnailPrompt) || `네이버 블로그 썸네일, 깔끔한 금융 리포트 스타일, 제목: ${title}, 핵심 문구: ${thumbnailText}`;
  const category = pipeline.channel === "blog" ? "주식시장 브리핑" : "콘텐츠";
  const body = `${bodyCore}\n\n---\n${INVESTMENT_DISCLAIMER}`;
  const markdownBody = `# ${title}\n\n${body}`;
  const htmlBody = toHtml(body);
  return { title, body, markdownBody, htmlBody, tags, category, thumbnailText, thumbnailPrompt, disclaimer: INVESTMENT_DISCLAIMER };
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
  return jobs.map(serializeNaverDraftJob);
}

export async function getNaverDraftJob(jobId: string) {
  const job = await prisma.naverDraftJob.findUnique({ where: { id: jobId } });
  return job ? serializeNaverDraftJob(job) : null;
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
  if (existing) return serializeNaverDraftJob(existing);

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
  return serializeNaverDraftJob(job);
}

export async function cancelNaverDraftJob(jobId: string) {
  const job = await prisma.naverDraftJob.findUnique({ where: { id: jobId } });
  if (!job) return null;
  if (["completed", "draft_saved"].includes(job.status)) throw new Error("NAVER_DRAFT_JOB_ALREADY_FINISHED");
  return serializeNaverDraftJob(await prisma.naverDraftJob.update({
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
  return job ? serializeNaverDraftJob(job) : null;
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
  if (["draft_saved", "user_publish_required", "completed", "failed", "login_required", "captcha_required", "security_check_required", "cancelled"].includes(input.status)) data.completedAt = now;
  const job = await prisma.naverDraftJob.update({ where: { id: jobId }, data });
  return serializeNaverDraftJob(job);
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
