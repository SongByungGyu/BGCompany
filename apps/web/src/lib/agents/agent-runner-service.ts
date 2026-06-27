import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { processAgentEvent } from "@/lib/events/event-processor";
import { createAgentRun, updateAgentRunStatus } from "@/lib/repositories/agent-runs";
import { AgentEventError, type AgentEventInput } from "@/lib/events/agent-event-types";
import { buildAgentRunContext, summarizeAgentRunContext } from "./agent-run-context-builder";
import { getAgentRunner, resolveAgentRunnerMode } from "./agent-runner-provider";
import { HermesClientError } from "./hermes-client";
import type { AgentRunRequest, AgentRunResult } from "./agent-runner-types";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function emit(input: AgentEventInput) {
  return processAgentEvent(input);
}

function validateRequest(input: unknown): AgentRunRequest {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new AgentEventError("INVALID_AGENT_RUN", "request body must be a JSON object", 400);
  }
  const body = input as Record<string, unknown>;
  if (typeof body.taskId !== "string" || !body.taskId.trim()) {
    throw new AgentEventError("INVALID_AGENT_RUN", "taskId is required", 400);
  }
  if (body.employeeId !== undefined && typeof body.employeeId !== "string") {
    throw new AgentEventError("INVALID_AGENT_RUN", "employeeId must be a string", 400);
  }
  const supportedModes = ["mock", "mock-error", "hermes", "hermes-dry-run"];
  if (body.mode !== undefined && (typeof body.mode !== "string" || !supportedModes.includes(body.mode))) {
    throw new AgentEventError("UNSUPPORTED_AGENT_RUN_MODE", "only mock/mock-error/hermes/hermes-dry-run mode is supported", 400);
  }
  return {
    taskId: body.taskId,
    employeeId: typeof body.employeeId === "string" ? body.employeeId : undefined,
    mode: typeof body.mode === "string" ? body.mode as AgentRunRequest["mode"] : undefined,
  };
}

async function createApprovalRequest(input: {
  approvalId: string;
  employeeId: string;
  taskId: string;
  title: string;
  type: string;
  risk: string;
  reason: string;
}) {
  await prisma.approvalRequest.upsert({
    where: { id: input.approvalId },
    update: {
      status: "승인 대기",
      reason: input.reason,
      updatedAt: new Date(),
    },
    create: {
      id: input.approvalId,
      title: input.title,
      requestedByEmployeeId: input.employeeId,
      taskId: input.taskId,
      approvalType: input.type,
      riskLevel: input.risk,
      estimatedCost: null,
      status: "승인 대기",
      reason: input.reason,
      plannedAction: "대표 승인 후 결과를 적용합니다.",
      expectedResult: "승인 후 업무가 다음 단계로 진행됩니다.",
    },
  });
}

export async function runAgentTask(input: unknown): Promise<AgentRunResult> {
  const request = validateRequest(input);
  const task = await prisma.task.findUnique({ where: { id: request.taskId } });
  if (!task) throw new AgentEventError("TASK_NOT_FOUND", `taskId does not exist: ${request.taskId}`, 404);

  const employeeId = request.employeeId ?? task.assignedEmployeeId;
  if (!employeeId) throw new AgentEventError("EMPLOYEE_NOT_ASSIGNED", "employeeId is required when task has no assigned employee", 400);

  const employee = await prisma.employee.findUnique({ where: { id: employeeId } });
  if (!employee) throw new AgentEventError("EMPLOYEE_NOT_FOUND", `employeeId does not exist: ${employeeId}`, 404);
  if (task.assignedEmployeeId && task.assignedEmployeeId !== employeeId) {
    throw new AgentEventError("EMPLOYEE_TASK_MISMATCH", `task ${task.id} is assigned to ${task.assignedEmployeeId}`, 400);
  }

  const runId = `run-${randomUUID()}`;
  const context = buildAgentRunContext({ runId, task, employee });
  const contextSummary = summarizeAgentRunContext(context);
  const runnerMode = resolveAgentRunnerMode(request.mode === "mock-error" ? "mock" : request.mode);
  const effectiveMode = request.mode ?? runnerMode;
  const runner = getAgentRunner(runnerMode);

  await createAgentRun({
    id: runId,
    taskId: task.id,
    employeeId,
    mode: effectiveMode,
    status: "running",
    triggerSource: "user",
    startedAt: new Date(),
    metadata: {
      contextSummary,
    },
  });

  const events = [];
  try {
    if (request.mode === "mock-error") {
      throw new Error("Forced mock agent run failure");
    }

  events.push(await emit({
    source: "mock",
    eventType: "TaskStarted",
    employeeId,
    taskId: task.id,
    payload: {
      runId,
      title: task.title,
      summary: `${context.agent.displayName} Agent가 업무 실행을 시작했습니다.`,
    },
  }));
  await wait(150);

  events.push(await emit({
    source: "mock",
    eventType: "EmployeeStatusChanged",
    employeeId,
    taskId: task.id,
    payload: {
      runId,
      status: employeeId === "stock-monitor" ? "조사 중" : employeeId === "qa-auditor" ? "검토 중" : "업무 중",
      summary: `${context.agent.displayName} Agent가 ${task.title} 업무를 수행 중입니다.`,
    },
  }));
  await wait(150);

  const plan = await runner.run(context);

  if (plan.runnerStatus === "submitted") {
    const resultSummary = plan.hermesJobId ? `Hermes job submitted: ${plan.hermesJobId}` : "Hermes job submitted";
    await updateAgentRunStatus({
      id: runId,
      status: "running",
      resultSummary,
      hermesJobId: plan.hermesJobId ?? null,
      metadata: {
        taskTitle: task.title,
        contextSummary,
        hermesJobId: plan.hermesJobId ?? null,
        hermesStatus: plan.hermesStatus ?? "submitted",
        hermesPayloadSummary: plan.hermesPayloadSummary ?? null,
        eventCount: events.length,
      } as Prisma.InputJsonValue,
    });

    return {
      ok: true,
      runId,
      taskId: task.id,
      employeeId,
      status: "running",
      mode: effectiveMode,
      events,
      resultSummary,
      hermesJobId: plan.hermesJobId,
    };
  }

  events.push(await emit({
    source: runnerMode === "hermes" || runnerMode === "hermes-dry-run" ? "hermes" : "mock",
    eventType: "OutputGenerated",
    employeeId,
    taskId: task.id,
    payload: {
      runId,
      summary: plan.summary,
      outputTitle: plan.outputTitle,
      output: plan.outputTitle,
      status: plan.requiresApproval ? "결과 대기" : plan.finalStatus,
    },
  }));
  await wait(150);

  let approvalId: string | undefined;
  if (plan.requiresApproval) {
    approvalId = `approval-${runId}`;
    await createApprovalRequest({
      approvalId,
      employeeId,
      taskId: task.id,
      title: `${task.title} 승인 요청`,
      type: plan.approvalType ?? "운영",
      risk: plan.approvalRisk ?? "보통",
      reason: plan.approvalReason ?? "Agent 실행 결과 적용 전 승인이 필요합니다.",
    });
    events.push(await emit({
      source: "mock",
      eventType: "ApprovalRequested",
      employeeId,
      taskId: task.id,
      approvalId,
      payload: {
        runId,
        title: `${task.title} 승인 요청`,
        summary: plan.approvalReason,
      },
    }));
  } else {
    events.push(await emit({
      source: "mock",
      eventType: "EmployeeStatusChanged",
      employeeId,
      taskId: task.id,
      payload: {
        runId,
        status: plan.finalStatus,
        summary: `${context.agent.displayName} Agent가 업무 실행을 마쳤습니다.`,
      },
    }));
  }

  const resultSummary = approvalId ? `${plan.outputTitle} · 승인 요청 생성` : plan.summary;
  await updateAgentRunStatus({
    id: runId,
    status: "succeeded",
    completedAt: new Date(),
    resultSummary,
    metadata: {
      taskTitle: task.title,
      contextSummary,
      outputTitle: plan.outputTitle,
      approvalId: approvalId ?? null,
      hermesStatus: plan.hermesStatus ?? null,
      hermesPayloadSummary: plan.hermesPayloadSummary ?? null,
      eventCount: events.length,
    } as Prisma.InputJsonValue,
  });

  return {
    ok: true,
    runId,
    taskId: task.id,
    employeeId,
    status: "succeeded",
    mode: effectiveMode,
    events,
    approvalId,
    resultSummary,
  };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown agent run error";
    await emit({
      source: "mock",
      eventType: "ErrorOccurred",
      employeeId,
      taskId: task.id,
      payload: {
        runId,
        summary: `${context.agent.displayName} Agent 실행 실패`,
        error: message,
      },
    }).catch(() => null);
    await updateAgentRunStatus({
      id: runId,
      status: "failed",
      completedAt: new Date(),
      errorMessage: message,
      metadata: {
        contextSummary,
        runnerMode,
        eventCount: events.length,
      } as Prisma.InputJsonValue,
    });
    const errorCode = error instanceof HermesClientError ? error.code : "AGENT_RUN_FAILED";
    throw new AgentEventError(errorCode, message, error instanceof HermesClientError ? error.status ?? 500 : 500);
  }
}
