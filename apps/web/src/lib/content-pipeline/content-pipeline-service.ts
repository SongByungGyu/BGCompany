import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { createAgentRun, updateAgentRunStatus } from "@/lib/repositories/agent-runs";
import { createEvent } from "@/lib/repositories/events";
import { serializeApproval, serializeTask, serializeTimeline } from "@/lib/repositories/serializers";
import type { ContentChannel, ContentPipelineDetail, ContentPipelineRun, ContentPipelineStatus } from "@/features/content-pipeline/content-pipeline-types";

type ContentPipelineInput = {
  topic: string;
  channel: ContentChannel;
  title: string;
  runnerMode?: "mock" | "hermes-dry-run" | "hermes";
};

const channels = new Set(["blog", "instagram", "youtube", "newsletter"]);

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
}): Prisma.InputJsonObject {
  return {
    contentPipelineId: input.pipelineId,
    topic: input.topic,
    channel: input.channel,
    title: input.title,
    runnerMode: input.runnerMode,
    taskIds: input.taskIds,
    approvalId: input.approvalId,
    outputTitle: input.outputTitle,
    outputSummary: input.outputSummary,
  };
}

async function createSucceededAgentRun(input: {
  pipelineId: string;
  taskId: string;
  employeeId: string;
  mode: string;
  summary: string;
  outputTitle: string;
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
    metadata: {
      contentPipelineId: input.pipelineId,
      outputTitle: input.outputTitle,
    },
  });
  return updateAgentRunStatus({
    id: runId,
    status: "succeeded",
    completedAt: new Date(),
    resultSummary: input.summary,
    metadata: {
      contentPipelineId: input.pipelineId,
      outputTitle: input.outputTitle,
      resultSummary: input.summary,
    },
  });
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
  return {
    id: pipelineId,
    title: typeof payload.title === "string" ? payload.title : "콘텐츠 파이프라인",
    topic: typeof payload.topic === "string" ? payload.topic : "주제 미정",
    channel: channels.has(String(payload.channel)) ? payload.channel as ContentChannel : "blog",
    status: "director_approval",
    currentStep: "Director 승인 대기",
    taskIds,
    approvalId: typeof payload.approvalId === "string" ? payload.approvalId : undefined,
    outputTitle: typeof payload.outputTitle === "string" ? payload.outputTitle : undefined,
    outputSummary: typeof payload.outputSummary === "string" ? payload.outputSummary : undefined,
    runnerMode: typeof payload.runnerMode === "string" ? payload.runnerMode as ContentPipelineRun["runnerMode"] : "mock",
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
  const status = pipelineStatusFromApproval(approval?.status);
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
    timeline: timeline.map((item) => {
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
  const pipelineId = `content-pipeline-${randomUUID()}`;
  const suffix = pipelineId.replace("content-pipeline-", "").slice(0, 8);
  const now = new Date();
  const outputTitle = `${data.title} · ${channelLabel(data.channel)} 초안`;
  const outputSummary = `${data.topic} 주제로 기획, 마케팅 검토, QA 검토를 완료하고 Director 승인을 요청했습니다.`;
  const contentTaskId = `task-content-${suffix}`;
  const marketingTaskId = `task-marketing-${suffix}`;
  const qaTaskId = `task-qa-${suffix}`;
  const approvalId = `approval-content-${suffix}`;
  const taskIds = [contentTaskId, marketingTaskId, qaTaskId];
  const metadata = pipelineMetadata({
    pipelineId,
    topic: data.topic,
    channel: data.channel,
    title: data.title,
    runnerMode,
    taskIds,
    approvalId,
    outputTitle,
    outputSummary,
  });

  await prisma.task.createMany({
    data: [
      {
        id: contentTaskId,
        title: `[콘텐츠 기획] ${data.title}`,
        description: `${data.topic} 주제의 ${channelLabel(data.channel)} 콘텐츠 제목/개요/초안 방향을 작성합니다.`,
        department: "콘텐츠팀",
        assignedEmployeeId: "content-planner",
        status: "완료",
        progress: 100,
        startedAt: now,
        completedAt: now,
        model: runnerMode === "mock" ? "Mock Agent" : "Hermes Agent",
        cost: "0.0000",
        currentStep: "기획 완료",
        recentOutput: outputTitle,
        nextAction: "마케팅 문구 검토",
      },
      {
        id: marketingTaskId,
        title: `[마케팅 검토] ${data.title}`,
        description: `${data.topic} 콘텐츠의 제목, 썸네일, 홍보 문구를 검토합니다.`,
        department: "콘텐츠팀",
        assignedEmployeeId: "marketing-manager",
        status: "완료",
        progress: 100,
        startedAt: now,
        completedAt: now,
        model: runnerMode === "mock" ? "Mock Agent" : "Hermes Agent",
        cost: "0.0000",
        currentStep: "마케팅 검토 완료",
        recentOutput: "제목/홍보 문구 검토안 생성",
        nextAction: "QA 검토",
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
        model: runnerMode === "mock" ? "Mock Agent" : "Hermes Agent",
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
      riskLevel: "보통",
      estimatedCost: "0.0000",
      status: "승인 대기",
      reason: `${data.topic} 콘텐츠를 ${channelLabel(data.channel)} 채널에 게시하기 전 대표 최종 승인이 필요합니다.`,
      plannedAction: "승인 후 게시 준비 상태로 전환합니다.",
      expectedResult: "콘텐츠 결과물이 게시 준비 상태가 됩니다.",
    },
  });

  await createSucceededAgentRun({ pipelineId, taskId: contentTaskId, employeeId: "content-planner", mode: runnerMode, outputTitle, summary: "콘텐츠 기획 초안 생성 완료" });
  await createSucceededAgentRun({ pipelineId, taskId: marketingTaskId, employeeId: "marketing-manager", mode: runnerMode, outputTitle: "마케팅 검토안 생성", summary: "제목/홍보 문구 검토 완료" });
  await createSucceededAgentRun({ pipelineId, taskId: qaTaskId, employeeId: "qa-auditor", mode: runnerMode, outputTitle: "QA 검토 결과 생성", summary: "사실성/정책/품질 검토 완료" });

  await createEvent({ type: "ContentPipelineStarted", payload: metadata, summary: `${data.title} 콘텐츠 파이프라인 시작` });
  await createEvent({ type: "TaskStarted", employeeId: "content-planner", taskId: contentTaskId, payload: { ...metadata, title: data.title }, summary: "콘텐츠 기획 시작" });
  await createEvent({ type: "OutputGenerated", employeeId: "content-planner", taskId: contentTaskId, payload: { ...metadata, outputTitle, output: outputTitle, status: "업무 완료" }, summary: "콘텐츠 기획 초안 생성" });
  await createEvent({ type: "TaskStarted", employeeId: "marketing-manager", taskId: marketingTaskId, payload: { ...metadata, title: data.title }, summary: "마케팅 검토 시작" });
  await createEvent({ type: "OutputGenerated", employeeId: "marketing-manager", taskId: marketingTaskId, payload: { ...metadata, outputTitle: "마케팅 검토안 생성", output: "제목/홍보 문구 검토안", status: "업무 완료" }, summary: "마케팅 검토 완료" });
  await createEvent({ type: "TaskStarted", employeeId: "qa-auditor", taskId: qaTaskId, payload: { ...metadata, title: data.title }, summary: "QA 검토 시작" });
  await createEvent({ type: "OutputGenerated", employeeId: "qa-auditor", taskId: qaTaskId, payload: { ...metadata, outputTitle: "QA 검토 결과 생성", output: "QA 검토 통과 · 최종 승인 필요", status: "검토 중" }, summary: "QA 검토 결과 생성" });
  await createEvent({ type: "ApprovalRequested", employeeId: "director", taskId: qaTaskId, approvalId, payload: { ...metadata, title: `[콘텐츠 최종 승인] ${data.title}`, status: "승인 대기" }, summary: "Director 콘텐츠 최종 승인 요청" });

  return {
    id: pipelineId,
    title: data.title,
    topic: data.topic,
    channel: data.channel,
    status: "director_approval",
    currentStep: "Director 승인 대기",
    taskIds,
    approvalId,
    outputTitle,
    outputSummary,
    runnerMode,
    createdAt: now.toISOString(),
    updatedAt: new Date().toISOString(),
  };
}
