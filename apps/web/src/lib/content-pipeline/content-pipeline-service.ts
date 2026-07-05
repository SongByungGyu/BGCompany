import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { createAgentRun, updateAgentRunStatus, type AgentRunStatus } from "@/lib/repositories/agent-runs";
import { createEvent } from "@/lib/repositories/events";
import { serializeApproval, serializeTask, serializeTimeline } from "@/lib/repositories/serializers";
import { buildContentPlannerHermesPayload, buildMarketingReviewHermesPayload, runContentPlannerHermes, runMarketingReviewHermes } from "@/lib/hermes/hermes-client";
import { assertHermesDailyRunAvailable } from "@/lib/hermes/hermes-usage";
import type { NormalizedHermesRunResult } from "@/lib/hermes/hermes-types";
import type { ContentChannel, ContentPipelineDetail, ContentPipelineRun, ContentPipelineStatus } from "@/features/content-pipeline/content-pipeline-types";

type ContentPipelineInput = {
  topic: string;
  channel: ContentChannel;
  title: string;
  runnerMode?: "mock" | "hermes-dry-run" | "hermes";
};

type PlannerExecution = {
  status: "succeeded" | "failed" | "dry-run";
  taskStatus: "완료" | "오류";
  progress: number;
  currentStep: string;
  outputTitle: string;
  outputSummary: string;
  recentOutput: string;
  result: Record<string, unknown>;
  hermesPayload?: Record<string, unknown>;
  hermesResponse?: Record<string, unknown>;
  agentRunStatus: AgentRunStatus;
  agentRunSummary?: string;
  agentRunError?: string;
  hermesJobId?: string;
};

type MarketingExecution = {
  status: "succeeded" | "failed" | "dry-run";
  taskStatus: "완료" | "오류";
  progress: number;
  currentStep: string;
  outputTitle: string;
  outputSummary: string;
  recentOutput: string;
  result: Record<string, unknown>;
  hermesPayload?: Record<string, unknown>;
  hermesResponse?: Record<string, unknown>;
  agentRunMode: string;
  agentRunStatus: AgentRunStatus;
  agentRunSummary?: string;
  agentRunError?: string;
  hermesJobId?: string;
};

type NormalizedPipelineResult = NormalizedHermesRunResult & Record<string, unknown>;

const channels = new Set(["blog", "instagram", "youtube", "newsletter"]);
const HERMES_PIPELINE_REQUIRED_RUNS = 2;

function assertValidInput(input: unknown): ContentPipelineInput {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("request body must be a JSON object");
  }
  const body = input as Record<string, unknown>;
  const topic = typeof body.topic === "string" ? body.topic.trim() : "";
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const channel = typeof body.channel === "string" ? body.channel : "";
  const runnerMode = typeof body.runnerMode === "string" ? body.runnerMode : "mock";
  if (!topic) throw new Error("topic is required");
  if (!title) throw new Error("title is required");
  if (!channels.has(channel)) throw new Error("channel must be blog/instagram/youtube/newsletter");
  if (!["mock", "hermes-dry-run", "hermes"].includes(runnerMode)) throw new Error("runnerMode must be mock/hermes-dry-run/hermes");
  return { topic, title, channel: channel as ContentChannel, runnerMode: runnerMode as ContentPipelineInput["runnerMode"] };
}

function channelLabel(channel: ContentChannel) {
  if (channel === "instagram") return "Instagram";
  if (channel === "youtube") return "YouTube";
  if (channel === "newsletter") return "Newsletter";
  return "Blog";
}

function toJsonObject(value: Record<string, unknown>): Prisma.InputJsonObject {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonObject;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function asStringArray(value: unknown) {
  if (!Array.isArray(value)) return undefined;
  const items = value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
  return items.length > 0 ? items : undefined;
}

function asParseStatus(value: unknown) {
  return value === "json" || value === "json_extracted" || value === "fallback_text" ? value : undefined;
}

function asNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function normalizeResultForMetadata(result: NormalizedPipelineResult): Record<string, unknown> {
  return toJsonObject({
    ok: result.ok,
    provider: result.provider,
    agentId: result.agentId,
    title: result.title,
    summary: result.summary,
    content: result.content,
    draftDirection: result.draftDirection,
    outline: result.outline,
    seoKeywords: result.seoKeywords,
    targetAudience: result.targetAudience,
    tone: result.tone,
    thumbnailIdea: result.thumbnailIdea,
    cta: result.cta,
    reviewSummary: result.reviewSummary,
    titleSuggestions: result.titleSuggestions,
    recommendedTitle: result.recommendedTitle,
    thumbnailCopy: result.thumbnailCopy,
    introHook: result.introHook,
    promotionCopy: result.promotionCopy,
    clickPoints: result.clickPoints,
    riskNotes: result.riskNotes,
    improvementSuggestions: result.improvementSuggestions,
    marketingScore: result.marketingScore,
    finalRecommendation: result.finalRecommendation,
    reason: result.reason,
    parseStatus: result.parseStatus,
    rawText: result.rawText,
    hermesJobId: result.hermesJobId,
    durationMs: result.durationMs,
    errorCode: result.errorCode,
    errorMessage: result.errorMessage,
    raw: result.raw,
  });
}

function pipelineMetadata(input: {
  pipelineId: string;
  topic: string;
  channel: ContentChannel;
  title: string;
  runnerMode: string;
  taskIds: string[];
  approvalId: string;
  outputTitle: string;
  outputSummary: string;
  plannerResult: Record<string, unknown>;
  marketingResult?: Record<string, unknown>;
  hermesRequestPayload?: Record<string, unknown>;
  hermesMarketingRequestPayload?: Record<string, unknown>;
}): Prisma.InputJsonObject {
  return toJsonObject({
    contentPipelineId: input.pipelineId,
    topic: input.topic,
    channel: input.channel,
    title: input.title,
    runnerMode: input.runnerMode,
    taskIds: input.taskIds,
    approvalId: input.approvalId,
    outputTitle: input.outputTitle,
    outputSummary: input.outputSummary,
    plannerResult: input.plannerResult,
    marketingResult: input.marketingResult,
    hermesRequestPayload: input.hermesRequestPayload,
    hermesMarketingRequestPayload: input.hermesMarketingRequestPayload,
  });
}

async function createPipelineAgentRun(input: {
  pipelineId: string;
  taskId: string;
  employeeId: string;
  mode: string;
  status: AgentRunStatus;
  summary?: string;
  errorMessage?: string;
  hermesJobId?: string;
  metadata: Record<string, unknown>;
}) {
  const runId = `run-${randomUUID()}`;
  await createAgentRun({
    id: runId,
    taskId: input.taskId,
    employeeId: input.employeeId,
    mode: input.mode,
    status: "running",
    triggerSource: "content-pipeline",
    startedAt: new Date(),
    metadata: toJsonObject({
      contentPipelineId: input.pipelineId,
      ...input.metadata,
    }),
  });
  return updateAgentRunStatus({
    id: runId,
    status: input.status,
    completedAt: new Date(),
    resultSummary: input.summary ?? null,
    errorMessage: input.errorMessage ?? null,
    hermesJobId: input.hermesJobId ?? null,
    metadata: toJsonObject({
      contentPipelineId: input.pipelineId,
      ...input.metadata,
      resultSummary: input.summary,
      errorMessage: input.errorMessage,
      hermesJobId: input.hermesJobId,
    }),
  });
}

function mockPlannerExecution(data: ContentPipelineInput): PlannerExecution {
  const outputTitle = `${data.title} · ${channelLabel(data.channel)} 초안`;
  const outputSummary = `${data.topic} 주제로 기획, 마케팅 검토, QA 검토를 완료하고 Director 승인을 요청했습니다.`;
  return {
    status: "succeeded",
    taskStatus: "완료",
    progress: 100,
    currentStep: "기획 완료",
    outputTitle,
    outputSummary,
    recentOutput: outputTitle,
    agentRunStatus: "succeeded",
    agentRunSummary: "콘텐츠 기획 초안 생성 완료",
    result: {
      ok: true,
      provider: "mock",
      agentId: "content-planner",
      title: outputTitle,
      summary: outputSummary,
      outline: ["주제 소개", "구축 과정", "운영 흐름", "다음 단계"],
      content: `${data.topic}를 ${channelLabel(data.channel)} 콘텐츠로 정리하는 mock 초안 방향입니다.`,
      draftDirection: "운영 기록을 독자가 따라 할 수 있는 구축기 형식으로 구성합니다.",
      seoKeywords: ["AI 개인회사", "BG Company", "자동화", "콘텐츠 파이프라인"],
      targetAudience: "AI 기반 개인회사/업무 자동화에 관심 있는 실무자",
      tone: "실무적이고 친근한 구축기 톤",
      thumbnailIdea: "가상 오피스 대시보드와 AI 직원 카드가 보이는 미니멀 썸네일",
      cta: "다음 편에서 실제 운영 자동화 과정을 확인해보세요.",
      parseStatus: "json",
      durationMs: 0,
    },
  };
}

function dryRunPlannerExecution(data: ContentPipelineInput): PlannerExecution {
  const hermesPayload = buildContentPlannerHermesPayload({
    topic: data.topic,
    title: data.title,
    channel: data.channel,
    language: "ko",
  });
  const outputTitle = `${data.title} · Hermes dry-run payload`;
  const outputSummary = "Hermes를 실제 호출하지 않고 content-planner 요청 payload를 생성했습니다.";
  return {
    status: "dry-run",
    taskStatus: "완료",
    progress: 100,
    currentStep: "Hermes dry-run payload 생성",
    outputTitle,
    outputSummary,
    recentOutput: outputTitle,
    agentRunStatus: "succeeded",
    agentRunSummary: outputSummary,
    hermesPayload: toJsonObject(hermesPayload),
    result: {
      ok: true,
      provider: "hermes",
      agentId: "content-planner",
      title: outputTitle,
      summary: outputSummary,
      outline: ["Hermes 요청 payload 검증", "계약 필드 확인", "실제 호출 전 점검"],
      seoKeywords: ["Hermes", "content-planner", "dry-run"],
      targetAudience: "운영 전 payload를 점검하는 관리자",
      tone: "검증 중심",
      cta: "payload 확인 후 필요할 때만 실제 Hermes 실행을 진행하세요.",
      parseStatus: "json",
      durationMs: 0,
    },
  };
}

async function hermesPlannerExecution(data: ContentPipelineInput): Promise<PlannerExecution> {
  const { payload, result } = await runContentPlannerHermes({
    topic: data.topic,
    title: data.title,
    channel: data.channel,
    language: "ko",
  });
  const hermesPayload = toJsonObject(payload);
  const normalizedResult = normalizeResultForMetadata(result);

  if (!result.ok) {
    const outputTitle = `${data.title} · Hermes 실행 실패`;
    const outputSummary = result.errorMessage ?? "Hermes content-planner 실행에 실패했습니다.";
    return {
      status: "failed",
      taskStatus: "오류",
      progress: 30,
      currentStep: "Hermes 실행 실패",
      outputTitle,
      outputSummary,
      recentOutput: outputSummary,
      agentRunStatus: "failed",
      agentRunError: outputSummary,
      hermesPayload,
      hermesResponse: normalizedResult,
      result: normalizedResult,
    };
  }

  const outputTitle = result.title ?? `${data.title} · Hermes 기획안`;
  const outputSummary = result.summary ?? result.draftDirection ?? "Hermes content-planner가 콘텐츠 기획 결과를 반환했습니다.";
  return {
    status: "succeeded",
    taskStatus: "완료",
    progress: 100,
    currentStep: "Hermes 기획 완료",
    outputTitle,
    outputSummary,
    recentOutput: outputTitle,
    agentRunStatus: "succeeded",
    agentRunSummary: outputSummary,
    hermesJobId: result.hermesJobId,
    hermesPayload,
    hermesResponse: normalizedResult,
    result: normalizedResult,
  };
}

async function executePlanner(data: ContentPipelineInput): Promise<PlannerExecution> {
  const runnerMode = data.runnerMode ?? "mock";
  if (runnerMode === "hermes-dry-run") return dryRunPlannerExecution(data);
  if (runnerMode === "hermes") return hermesPlannerExecution(data);
  return mockPlannerExecution(data);
}

function mockMarketingExecution(data: ContentPipelineInput, planner: PlannerExecution): MarketingExecution {
  const recommendedTitle = planner.result.title && typeof planner.result.title === "string" ? planner.result.title : data.title;
  const reviewSummary = `${recommendedTitle}의 제목, 썸네일, SEO, 홍보 문구를 mock 기준으로 검토했습니다.`;
  return {
    status: "succeeded",
    taskStatus: "완료",
    progress: 100,
    currentStep: "마케팅 검토 완료",
    outputTitle: "마케팅 검토안 생성",
    outputSummary: reviewSummary,
    recentOutput: "제목/홍보 문구 검토안 생성",
    agentRunMode: "mock",
    agentRunStatus: "succeeded",
    agentRunSummary: reviewSummary,
    result: {
      ok: true,
      provider: "mock",
      agentId: "marketing-manager",
      reviewSummary,
      titleSuggestions: [recommendedTitle, `${recommendedTitle} · 운영자가 바로 따라 하는 구축기`, `${data.topic} 실전 기록`],
      recommendedTitle,
      thumbnailCopy: "AI 개인회사 구축기",
      seoKeywords: ["AI 개인회사", "BG Company", "콘텐츠 자동화", "Hermes"],
      introHook: "혼자 운영하는 회사가 실제로 일하는 화면을 만든다면 어디서부터 시작해야 할까요?",
      promotionCopy: { short: "BG Company 구축 과정을 한 편으로 정리했습니다.", long: "가상 오피스, 업무 보드, 승인함, 콘텐츠 파이프라인이 어떻게 연결되는지 실제 운영 흐름 기준으로 소개합니다." },
      clickPoints: ["실제 구축 과정", "운영 화면 중심", "AI 직원 협업 구조"],
      riskNotes: ["과장된 자동화 표현은 피하고 현재 구현 범위를 명확히 표시"],
      improvementSuggestions: ["초반에 결과 화면을 먼저 보여주고 구축 과정을 이어서 설명"],
      marketingScore: 82,
      finalRecommendation: "approve",
      reason: "콘텐츠 주제와 운영 화면의 연결성이 명확합니다.",
      parseStatus: "json",
      durationMs: 0,
    },
  };
}

function dryRunMarketingExecution(data: ContentPipelineInput, planner: PlannerExecution): MarketingExecution {
  const hermesPayload = buildMarketingReviewHermesPayload({
    topic: data.topic,
    title: data.title,
    channel: data.channel,
    language: "ko",
    plannerResult: planner.result,
  });
  const outputSummary = "Hermes를 실제 호출하지 않고 marketing-manager 요청 payload를 생성했습니다.";
  return {
    status: "dry-run",
    taskStatus: "완료",
    progress: 100,
    currentStep: "Hermes marketing dry-run payload 생성",
    outputTitle: `${data.title} · Marketing Hermes dry-run payload`,
    outputSummary,
    recentOutput: "marketing-manager payload 생성",
    agentRunMode: "hermes-dry-run",
    agentRunStatus: "succeeded",
    agentRunSummary: outputSummary,
    hermesPayload: toJsonObject(hermesPayload),
    result: {
      ok: true,
      provider: "hermes",
      agentId: "marketing-manager",
      reviewSummary: outputSummary,
      titleSuggestions: [data.title],
      recommendedTitle: data.title,
      thumbnailCopy: "dry-run thumbnail copy",
      seoKeywords: ["Hermes", "marketing-manager", "dry-run"],
      introHook: "dry-run hook",
      promotionCopy: { short: "dry-run short copy", long: "dry-run long copy" },
      clickPoints: ["payload 검증"],
      riskNotes: ["실제 호출 없음"],
      improvementSuggestions: ["payload 확인 후 실제 실행"],
      marketingScore: 0,
      finalRecommendation: "revise",
      reason: "dry-run 결과입니다.",
      parseStatus: "json",
      durationMs: 0,
    },
  };
}

async function hermesMarketingExecution(data: ContentPipelineInput, planner: PlannerExecution): Promise<MarketingExecution> {
  if (planner.agentRunStatus === "failed") {
    const outputSummary = "content-planner 실패로 marketing-manager Hermes 실행을 건너뛰었습니다.";
    return {
      status: "failed",
      taskStatus: "오류",
      progress: 0,
      currentStep: "content-planner 확인 필요",
      outputTitle: `${data.title} · 마케팅 실행 보류`,
      outputSummary,
      recentOutput: outputSummary,
      agentRunMode: "hermes-skipped",
      agentRunStatus: "failed",
      agentRunError: outputSummary,
      result: {
        ok: false,
        provider: "hermes-bridge",
        agentId: "marketing-manager",
        errorCode: "MARKETING_SKIPPED_AFTER_PLANNER_FAILURE",
        errorMessage: outputSummary,
      },
    };
  }

  const { payload, result } = await runMarketingReviewHermes({
    topic: data.topic,
    title: data.title,
    channel: data.channel,
    language: "ko",
    plannerResult: planner.result,
  });
  const hermesPayload = toJsonObject(payload);
  const normalizedResult = normalizeResultForMetadata(result as NormalizedPipelineResult);

  if (!result.ok) {
    const outputTitle = `${data.title} · Marketing Hermes 실행 실패`;
    const outputSummary = result.errorMessage ?? "Hermes marketing-manager 실행에 실패했습니다.";
    return {
      status: "failed",
      taskStatus: "오류",
      progress: 30,
      currentStep: "Marketing Hermes 실행 실패",
      outputTitle,
      outputSummary,
      recentOutput: outputSummary,
      agentRunMode: "hermes",
      agentRunStatus: "failed",
      agentRunError: outputSummary,
      hermesPayload,
      hermesResponse: normalizedResult,
      result: normalizedResult,
    };
  }

  const outputTitle = result.recommendedTitle ?? `${data.title} · 마케팅 검토안`;
  const outputSummary = result.reviewSummary ?? result.reason ?? "Hermes marketing-manager가 마케팅 검토 결과를 반환했습니다.";
  return {
    status: "succeeded",
    taskStatus: "완료",
    progress: 100,
    currentStep: "Hermes 마케팅 검토 완료",
    outputTitle,
    outputSummary,
    recentOutput: outputTitle,
    agentRunMode: "hermes",
    agentRunStatus: "succeeded",
    agentRunSummary: outputSummary,
    hermesJobId: result.hermesJobId,
    hermesPayload,
    hermesResponse: normalizedResult,
    result: normalizedResult,
  };
}

async function executeMarketing(data: ContentPipelineInput, planner: PlannerExecution): Promise<MarketingExecution> {
  const runnerMode = data.runnerMode ?? "mock";
  if (runnerMode === "hermes-dry-run") return dryRunMarketingExecution(data, planner);
  if (runnerMode === "hermes") return hermesMarketingExecution(data, planner);
  return mockMarketingExecution(data, planner);
}

function runFromEvent(event: {
  id: string;
  timestamp: Date;
  payload: Prisma.JsonValue;
}): ContentPipelineRun | null {
  if (!event.payload || typeof event.payload !== "object" || Array.isArray(event.payload)) return null;
  const payload = event.payload as Record<string, unknown>;
  const pipelineId = typeof payload.contentPipelineId === "string" ? payload.contentPipelineId : event.id;
  const taskIds = Array.isArray(payload.taskIds) ? payload.taskIds.filter((id): id is string => typeof id === "string") : [];
  const plannerResult = asRecord(payload.plannerResult);
  const marketingResult = asRecord(payload.marketingResult);
  return {
    id: pipelineId,
    title: typeof payload.title === "string" ? payload.title : "콘텐츠 파이프라인",
    topic: typeof payload.topic === "string" ? payload.topic : "주제 미정",
    channel: channels.has(String(payload.channel)) ? payload.channel as ContentChannel : "blog",
    status: plannerResult?.ok === false ? "planning" : marketingResult?.ok === false ? "marketing_review" : "director_approval",
    currentStep: plannerResult?.ok === false ? "content-planner 확인 필요" : marketingResult?.ok === false ? "marketing-manager 확인 필요" : "Director 승인 대기",
    taskIds,
    approvalId: typeof payload.approvalId === "string" ? payload.approvalId : undefined,
    outputTitle: typeof payload.outputTitle === "string" ? payload.outputTitle : undefined,
    outputSummary: typeof payload.outputSummary === "string" ? payload.outputSummary : undefined,
    runnerMode: typeof payload.runnerMode === "string" ? payload.runnerMode as ContentPipelineRun["runnerMode"] : "mock",
    plannerResult: plannerResult ? {
      ok: plannerResult.ok !== false,
      provider: typeof plannerResult.provider === "string" ? plannerResult.provider : "mock",
      agentId: typeof plannerResult.agentId === "string" ? plannerResult.agentId : "content-planner",
      title: typeof plannerResult.title === "string" ? plannerResult.title : undefined,
      summary: typeof plannerResult.summary === "string" ? plannerResult.summary : undefined,
      content: typeof plannerResult.content === "string" ? plannerResult.content : undefined,
      draftDirection: typeof plannerResult.draftDirection === "string" ? plannerResult.draftDirection : undefined,
      outline: asStringArray(plannerResult.outline),
      seoKeywords: asStringArray(plannerResult.seoKeywords),
      targetAudience: typeof plannerResult.targetAudience === "string" ? plannerResult.targetAudience : undefined,
      tone: typeof plannerResult.tone === "string" ? plannerResult.tone : undefined,
      thumbnailIdea: typeof plannerResult.thumbnailIdea === "string" ? plannerResult.thumbnailIdea : undefined,
      cta: typeof plannerResult.cta === "string" ? plannerResult.cta : undefined,
      parseStatus: asParseStatus(plannerResult.parseStatus),
      rawText: typeof plannerResult.rawText === "string" ? plannerResult.rawText : undefined,
      durationMs: asNumber(plannerResult.durationMs),
      errorCode: typeof plannerResult.errorCode === "string" ? plannerResult.errorCode : undefined,
      errorMessage: typeof plannerResult.errorMessage === "string" ? plannerResult.errorMessage : undefined,
    } : undefined,
    marketingResult: marketingResult ? {
      ok: marketingResult.ok !== false,
      provider: typeof marketingResult.provider === "string" ? marketingResult.provider : "mock",
      agentId: typeof marketingResult.agentId === "string" ? marketingResult.agentId : "marketing-manager",
      reviewSummary: typeof marketingResult.reviewSummary === "string" ? marketingResult.reviewSummary : undefined,
      titleSuggestions: asStringArray(marketingResult.titleSuggestions),
      recommendedTitle: typeof marketingResult.recommendedTitle === "string" ? marketingResult.recommendedTitle : undefined,
      thumbnailCopy: typeof marketingResult.thumbnailCopy === "string" ? marketingResult.thumbnailCopy : undefined,
      seoKeywords: asStringArray(marketingResult.seoKeywords),
      introHook: typeof marketingResult.introHook === "string" ? marketingResult.introHook : undefined,
      promotionCopy: asRecord(marketingResult.promotionCopy) as { short?: string; long?: string } | undefined,
      clickPoints: asStringArray(marketingResult.clickPoints),
      riskNotes: asStringArray(marketingResult.riskNotes),
      improvementSuggestions: asStringArray(marketingResult.improvementSuggestions),
      marketingScore: asNumber(marketingResult.marketingScore),
      finalRecommendation: marketingResult.finalRecommendation === "approve" || marketingResult.finalRecommendation === "revise" ? marketingResult.finalRecommendation : undefined,
      reason: typeof marketingResult.reason === "string" ? marketingResult.reason : undefined,
      parseStatus: asParseStatus(marketingResult.parseStatus),
      rawText: typeof marketingResult.rawText === "string" ? marketingResult.rawText : undefined,
      durationMs: asNumber(marketingResult.durationMs),
      errorCode: typeof marketingResult.errorCode === "string" ? marketingResult.errorCode : undefined,
      errorMessage: typeof marketingResult.errorMessage === "string" ? marketingResult.errorMessage : undefined,
    } : undefined,
    hermesRequestPayload: asRecord(payload.hermesRequestPayload),
    hermesMarketingRequestPayload: asRecord(payload.hermesMarketingRequestPayload),
    createdAt: event.timestamp.toISOString(),
    updatedAt: event.timestamp.toISOString(),
  };
}

export async function listContentPipelines(): Promise<ContentPipelineRun[]> {
  const events = await prisma.eventLog.findMany({
    where: { type: "ContentPipelineStarted" },
    orderBy: { timestamp: "desc" },
    take: 20,
  });
  const runs = events.map(runFromEvent).filter((run): run is ContentPipelineRun => Boolean(run));
  const approvalIds = runs.map((run) => run.approvalId).filter((id): id is string => Boolean(id));
  const approvals = await prisma.approvalRequest.findMany({ where: { id: { in: approvalIds } } });
  const approvalsById = new Map(approvals.map((approval) => [approval.id, approval]));
  return runs.map((run) => {
    const approval = run.approvalId ? approvalsById.get(run.approvalId) : undefined;
    if (!approval) return run;
    if (approval.status === "승인 완료") return { ...run, status: "approved", currentStep: "승인 완료 · 게시 준비", updatedAt: approval.updatedAt.toISOString() };
    if (approval.status === "반려") return { ...run, status: "rejected", currentStep: "반려 · 수정 필요", updatedAt: approval.updatedAt.toISOString() };
    if (approval.status === "수정 요청") return { ...run, status: "revision_requested", currentStep: "수정 요청", updatedAt: approval.updatedAt.toISOString() };
    if (run.plannerResult?.ok === false) return { ...run, status: "planning", currentStep: "content-planner 확인 필요", updatedAt: approval.updatedAt.toISOString() };
    if (run.marketingResult?.ok === false) return { ...run, status: "marketing_review", currentStep: "marketing-manager 확인 필요", updatedAt: approval.updatedAt.toISOString() };
    return run;
  });
}

function pipelineStatusFromApproval(status?: string | null): { status: ContentPipelineStatus; currentStep: string } {
  if (status === "승인 완료") return { status: "approved", currentStep: "승인 완료 · 게시 준비" };
  if (status === "반려") return { status: "rejected", currentStep: "반려 · 수정 필요" };
  if (status === "수정 요청") return { status: "revision_requested", currentStep: "수정 요청" };
  if (status === "보류") return { status: "director_approval", currentStep: "승인 보류" };
  return { status: "director_approval", currentStep: "Director 승인 대기" };
}

function pipelineIdFromPayload(payload: Prisma.JsonValue, fallback: string) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return fallback;
  const value = (payload as Record<string, unknown>).contentPipelineId;
  return typeof value === "string" ? value : fallback;
}

function dedupeTimelineRows<T extends { id: string; eventId: string | null; title: string; description: string | null; timestamp: Date }>(rows: T[]) {
  const seen = new Set<string>();
  return rows.filter((row) => {
    const key = row.eventId
      ? `event:${row.eventId}`
      : `timeline:${row.title}:${row.description ?? ""}:${row.timestamp.toISOString()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function getContentPipelineDetail(pipelineId: string): Promise<ContentPipelineDetail | null> {
  const startedEvents = await prisma.eventLog.findMany({
    where: { type: "ContentPipelineStarted" },
    orderBy: { timestamp: "desc" },
    take: 100,
  });
  const event = startedEvents.find((candidate) => pipelineIdFromPayload(candidate.payload, candidate.id) === pipelineId);
  if (!event) return null;

  const baseRun = runFromEvent(event);
  if (!baseRun) return null;

  const tasks = baseRun.taskIds.length > 0
    ? await prisma.task.findMany({ where: { id: { in: baseRun.taskIds } } })
    : [];
  const agentRuns = baseRun.taskIds.length > 0
    ? await prisma.agentRun.findMany({ where: { taskId: { in: baseRun.taskIds } }, orderBy: { createdAt: "asc" } })
    : [];
  const approval = baseRun.approvalId
    ? await prisma.approvalRequest.findUnique({ where: { id: baseRun.approvalId } })
    : null;
  const timelineTargets = [
    ...baseRun.taskIds.map((taskId) => ({ targetType: "task", targetId: taskId })),
    baseRun.approvalId ? { targetType: "approval", targetId: baseRun.approvalId } : null,
  ].filter((target): target is { targetType: string; targetId: string } => Boolean(target));
  const timeline = timelineTargets.length > 0
    ? await prisma.timeline.findMany({
      where: { OR: timelineTargets },
      include: { event: true },
      orderBy: { timestamp: "desc" },
      take: 50,
    })
    : [];
  const dedupedTimeline = dedupeTimelineRows(timeline);
  const status = baseRun.plannerResult?.ok === false
    ? { status: "planning" as ContentPipelineStatus, currentStep: "content-planner 확인 필요" }
    : baseRun.marketingResult?.ok === false
      ? { status: "marketing_review" as ContentPipelineStatus, currentStep: "marketing-manager 확인 필요" }
      : pipelineStatusFromApproval(approval?.status);
  const pipeline: ContentPipelineRun = {
    ...baseRun,
    status: status.status,
    currentStep: status.currentStep,
    updatedAt: approval?.updatedAt.toISOString() ?? baseRun.updatedAt,
  };

  return {
    pipeline,
    tasks: tasks
      .map(serializeTask)
      .map((task) => ({
        id: task.id,
        title: task.title,
        status: task.status,
        progress: task.progress,
        assignedEmployeeId: task.assignedEmployeeId,
        currentStep: task.currentStep,
        recentOutput: task.recentOutput,
      })),
    approval: approval ? (() => {
      const item = serializeApproval(approval);
      return {
        id: item.id,
        title: item.title,
        status: item.status,
        requestedByEmployeeId: item.requestedByEmployeeId,
        taskId: item.taskId,
        reason: item.reason ?? "",
        decision: item.decision,
        decisionReason: item.decisionReason,
      };
    })() : null,
    agentRuns: agentRuns.map((run) => ({
      id: run.id,
      taskId: run.taskId,
      employeeId: run.employeeId,
      mode: run.mode,
      status: run.status,
      resultSummary: run.resultSummary,
      errorMessage: run.errorMessage,
      hermesJobId: run.hermesJobId,
      metadata: asRecord(run.metadata),
      createdAt: run.createdAt.toISOString(),
      updatedAt: run.updatedAt.toISOString(),
    })),
    timeline: dedupedTimeline.map((item) => {
      const serialized = serializeTimeline(item);
      return {
        ...serialized,
        timestamp: serialized.timestamp.toISOString(),
        event: item.event ? {
          ...item.event,
          timestamp: item.event.timestamp.toISOString(),
          payload: typeof item.event.payload === "object" && item.event.payload !== null && !Array.isArray(item.event.payload)
            ? item.event.payload as Record<string, unknown>
            : {},
        } : null,
      };
    }),
  };
}

export async function startContentPipeline(input: unknown): Promise<ContentPipelineRun> {
  const data = assertValidInput(input);
  const runnerMode = data.runnerMode ?? "mock";
  if (runnerMode === "hermes") await assertHermesDailyRunAvailable(HERMES_PIPELINE_REQUIRED_RUNS);

  const pipelineId = `content-pipeline-${randomUUID()}`;
  const suffix = pipelineId.replace("content-pipeline-", "").slice(0, 8);
  const now = new Date();
  const contentTaskId = `task-content-${suffix}`;
  const marketingTaskId = `task-marketing-${suffix}`;
  const qaTaskId = `task-qa-${suffix}`;
  const approvalId = `approval-content-${suffix}`;
  const taskIds = [contentTaskId, marketingTaskId, qaTaskId];
  const planner = await executePlanner(data);
  const marketing = await executeMarketing(data, planner);
  const metadata = pipelineMetadata({
    pipelineId,
    topic: data.topic,
    channel: data.channel,
    title: data.title,
    runnerMode,
    taskIds,
    approvalId,
    outputTitle: planner.outputTitle,
    outputSummary: marketing.agentRunStatus === "succeeded" ? marketing.outputSummary : planner.outputSummary,
    plannerResult: planner.result,
    marketingResult: marketing.result,
    hermesRequestPayload: planner.hermesPayload,
    hermesMarketingRequestPayload: marketing.hermesPayload,
  });

  await prisma.task.createMany({
    data: [
      {
        id: contentTaskId,
        title: `[콘텐츠 기획] ${data.title}`,
        description: `${data.topic} 주제의 ${channelLabel(data.channel)} 콘텐츠 제목/개요/초안 방향을 작성합니다.`,
        department: "콘텐츠팀",
        assignedEmployeeId: "content-planner",
        status: planner.taskStatus,
        progress: planner.progress,
        startedAt: now,
        completedAt: planner.agentRunStatus === "succeeded" ? now : null,
        model: runnerMode === "mock" ? "Mock Agent" : "Hermes Agent",
        cost: "0.0000",
        currentStep: planner.currentStep,
        recentOutput: planner.recentOutput,
        nextAction: planner.agentRunStatus === "failed" ? "Hermes 설정/응답 확인" : "마케팅 문구 검토",
        error: planner.agentRunError ?? null,
      },
      {
        id: marketingTaskId,
        title: `[마케팅 검토] ${data.title}`,
        description: `${data.topic} 콘텐츠의 제목, 썸네일, 홍보 문구를 검토합니다.`,
        department: "콘텐츠팀",
        assignedEmployeeId: "marketing-manager",
        status: marketing.taskStatus,
        progress: marketing.progress,
        startedAt: now,
        completedAt: marketing.agentRunStatus === "succeeded" ? now : null,
        model: marketing.agentRunMode === "mock" ? "Mock Agent" : marketing.agentRunMode === "hermes-dry-run" ? "Hermes Dry Run" : "Hermes Agent",
        cost: "0.0000",
        currentStep: marketing.currentStep,
        recentOutput: marketing.recentOutput,
        nextAction: marketing.agentRunStatus === "failed" ? "Marketing Hermes 설정/응답 확인" : "QA 검토",
        error: marketing.agentRunError ?? null,
      },
      {
        id: qaTaskId,
        title: `[QA 검토] ${data.title}`,
        description: `${data.topic} 콘텐츠의 사실성, 정책, 품질 기준을 검토합니다.`,
        department: "지식·감사",
        assignedEmployeeId: "qa-auditor",
        status: "승인 대기",
        progress: 92,
        startedAt: now,
        model: "Mock Agent",
        cost: "0.0000",
        currentStep: "Director 승인 대기",
        recentOutput: "QA 검토 통과 · 최종 승인 필요",
        nextAction: "Director 승인",
      },
    ],
  });

  await prisma.approvalRequest.create({
    data: {
      id: approvalId,
      title: `[콘텐츠 최종 승인] ${data.title}`,
      requestedByEmployeeId: "director",
      taskId: qaTaskId,
      approvalType: "콘텐츠",
      riskLevel: planner.agentRunStatus === "failed" || marketing.agentRunStatus === "failed" ? "높음" : "보통",
      estimatedCost: "0.0000",
      status: "승인 대기",
      reason: `${data.topic} 콘텐츠를 ${channelLabel(data.channel)} 채널에 게시하기 전 대표 최종 승인이 필요합니다.`,
      plannedAction: planner.agentRunStatus === "failed" || marketing.agentRunStatus === "failed" ? "Hermes 실패 사유를 확인한 뒤 재실행 또는 mock 결과로 검토합니다." : "승인 후 게시 준비 상태로 전환합니다.",
      expectedResult: "콘텐츠 결과물이 게시 준비 상태가 됩니다.",
    },
  });

  await createPipelineAgentRun({
    pipelineId,
    taskId: contentTaskId,
    employeeId: "content-planner",
    mode: runnerMode,
    status: planner.agentRunStatus,
    summary: planner.agentRunSummary,
    errorMessage: planner.agentRunError,
    hermesJobId: planner.hermesJobId,
    metadata: {
      role: "content-planner",
      hermesPayload: planner.hermesPayload,
      hermesResponse: planner.hermesResponse,
      plannerResult: planner.result,
    },
  });
  await createPipelineAgentRun({
    pipelineId,
    taskId: marketingTaskId,
    employeeId: "marketing-manager",
    mode: marketing.agentRunMode,
    status: marketing.agentRunStatus,
    summary: marketing.agentRunSummary,
    errorMessage: marketing.agentRunError,
    hermesJobId: marketing.hermesJobId,
    metadata: {
      role: "marketing-manager",
      hermesPayload: marketing.hermesPayload,
      hermesResponse: marketing.hermesResponse,
      plannerResult: planner.result,
      marketingResult: marketing.result,
    },
  });
  await createPipelineAgentRun({ pipelineId, taskId: qaTaskId, employeeId: "qa-auditor", mode: "mock", status: "succeeded", summary: "사실성/정책/품질 검토 완료", metadata: { role: "qa-auditor", outputTitle: "QA 검토 결과 생성" } });

  await createEvent({ type: "ContentPipelineStarted", payload: metadata, summary: `${data.title} 콘텐츠 파이프라인 시작` });
  await createEvent({ type: "TaskStarted", employeeId: "content-planner", taskId: contentTaskId, payload: { ...metadata, title: data.title }, summary: "콘텐츠 기획 시작" });
  if (planner.agentRunStatus === "failed") {
    await createEvent({
      type: "ErrorOccurred",
      employeeId: "content-planner",
      taskId: contentTaskId,
      payload: { ...metadata, error: planner.agentRunError, message: planner.agentRunError, status: "오류 대응 중" },
      summary: `content-planner Hermes 실행 실패 · ${planner.agentRunError ?? "원인 미상"}`,
    });
  } else {
    await createEvent({ type: "OutputGenerated", employeeId: "content-planner", taskId: contentTaskId, payload: { ...metadata, outputTitle: planner.outputTitle, output: planner.outputTitle, status: "업무 완료" }, summary: "콘텐츠 기획 초안 생성" });
  }
  await createEvent({ type: "TaskStarted", employeeId: "marketing-manager", taskId: marketingTaskId, payload: { ...metadata, title: data.title }, summary: "마케팅 검토 시작" });
  if (marketing.agentRunStatus === "failed") {
    await createEvent({
      type: "ErrorOccurred",
      employeeId: "marketing-manager",
      taskId: marketingTaskId,
      payload: { ...metadata, error: marketing.agentRunError, message: marketing.agentRunError, status: "오류 대응 중" },
      summary: `marketing-manager Hermes 실행 실패 · ${marketing.agentRunError ?? "원인 미상"}`,
    });
  } else {
    await createEvent({ type: "OutputGenerated", employeeId: "marketing-manager", taskId: marketingTaskId, payload: { ...metadata, outputTitle: marketing.outputTitle, output: marketing.outputSummary, status: "업무 완료" }, summary: "마케팅 검토 완료" });
  }
  await createEvent({ type: "TaskStarted", employeeId: "qa-auditor", taskId: qaTaskId, payload: { ...metadata, title: data.title }, summary: "QA 검토 시작" });
  await createEvent({ type: "OutputGenerated", employeeId: "qa-auditor", taskId: qaTaskId, payload: { ...metadata, outputTitle: "QA 검토 결과 생성", output: "QA 검토 통과 · 최종 승인 필요", status: "검토 중" }, summary: "QA 검토 결과 생성" });
  await createEvent({ type: "ApprovalRequested", employeeId: "director", taskId: qaTaskId, approvalId, payload: { ...metadata, title: `[콘텐츠 최종 승인] ${data.title}`, status: "승인 대기" }, summary: "Director 콘텐츠 최종 승인 요청" });

  return {
    id: pipelineId,
    title: data.title,
    topic: data.topic,
    channel: data.channel,
    status: planner.agentRunStatus === "failed" ? "planning" : marketing.agentRunStatus === "failed" ? "marketing_review" : "director_approval",
    currentStep: planner.agentRunStatus === "failed" ? "content-planner 확인 필요" : marketing.agentRunStatus === "failed" ? "marketing-manager 확인 필요" : "Director 승인 대기",
    taskIds,
    approvalId,
    outputTitle: planner.outputTitle,
    outputSummary: marketing.agentRunStatus === "succeeded" ? marketing.outputSummary : planner.outputSummary,
    runnerMode,
    plannerResult: {
      ok: planner.agentRunStatus !== "failed",
      provider: typeof planner.result.provider === "string" ? planner.result.provider : runnerMode === "mock" ? "mock" : "hermes",
      agentId: "content-planner",
      title: typeof planner.result.title === "string" ? planner.result.title : planner.outputTitle,
      summary: typeof planner.result.summary === "string" ? planner.result.summary : planner.outputSummary,
      content: typeof planner.result.content === "string" ? planner.result.content : undefined,
      draftDirection: typeof planner.result.draftDirection === "string" ? planner.result.draftDirection : undefined,
      outline: asStringArray(planner.result.outline),
      seoKeywords: asStringArray(planner.result.seoKeywords),
      targetAudience: typeof planner.result.targetAudience === "string" ? planner.result.targetAudience : undefined,
      tone: typeof planner.result.tone === "string" ? planner.result.tone : undefined,
      thumbnailIdea: typeof planner.result.thumbnailIdea === "string" ? planner.result.thumbnailIdea : undefined,
      cta: typeof planner.result.cta === "string" ? planner.result.cta : undefined,
      parseStatus: asParseStatus(planner.result.parseStatus),
      rawText: typeof planner.result.rawText === "string" ? planner.result.rawText : undefined,
      durationMs: asNumber(planner.result.durationMs),
      errorCode: typeof planner.result.errorCode === "string" ? planner.result.errorCode : undefined,
      errorMessage: typeof planner.result.errorMessage === "string" ? planner.result.errorMessage : undefined,
    },
    marketingResult: {
      ok: marketing.agentRunStatus !== "failed",
      provider: typeof marketing.result.provider === "string" ? marketing.result.provider : marketing.agentRunMode,
      agentId: "marketing-manager",
      reviewSummary: typeof marketing.result.reviewSummary === "string" ? marketing.result.reviewSummary : marketing.outputSummary,
      titleSuggestions: asStringArray(marketing.result.titleSuggestions),
      recommendedTitle: typeof marketing.result.recommendedTitle === "string" ? marketing.result.recommendedTitle : undefined,
      thumbnailCopy: typeof marketing.result.thumbnailCopy === "string" ? marketing.result.thumbnailCopy : undefined,
      seoKeywords: asStringArray(marketing.result.seoKeywords),
      introHook: typeof marketing.result.introHook === "string" ? marketing.result.introHook : undefined,
      promotionCopy: asRecord(marketing.result.promotionCopy) as { short?: string; long?: string } | undefined,
      clickPoints: asStringArray(marketing.result.clickPoints),
      riskNotes: asStringArray(marketing.result.riskNotes),
      improvementSuggestions: asStringArray(marketing.result.improvementSuggestions),
      marketingScore: asNumber(marketing.result.marketingScore),
      finalRecommendation: marketing.result.finalRecommendation === "approve" || marketing.result.finalRecommendation === "revise" ? marketing.result.finalRecommendation : undefined,
      reason: typeof marketing.result.reason === "string" ? marketing.result.reason : undefined,
      parseStatus: asParseStatus(marketing.result.parseStatus),
      rawText: typeof marketing.result.rawText === "string" ? marketing.result.rawText : undefined,
      durationMs: asNumber(marketing.result.durationMs),
      errorCode: typeof marketing.result.errorCode === "string" ? marketing.result.errorCode : undefined,
      errorMessage: typeof marketing.result.errorMessage === "string" ? marketing.result.errorMessage : undefined,
    },
    hermesRequestPayload: planner.hermesPayload,
    hermesMarketingRequestPayload: marketing.hermesPayload,
    createdAt: now.toISOString(),
    updatedAt: new Date().toISOString(),
  };
}
