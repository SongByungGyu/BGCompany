import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { processAgentEvent } from "@/lib/events/event-processor";
import { createAgentRun, updateAgentRunStatus } from "@/lib/repositories/agent-runs";
import { AgentEventError, type AgentEventInput } from "@/lib/events/agent-event-types";
import { getAgentMetadata } from "./agent-registry";
import { createMockAgentRunPlan } from "./mock-agent-runner";
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
  if (body.mode !== undefined && body.mode !== "mock" && body.mode !== "mock-error") {
    throw new AgentEventError("UNSUPPORTED_AGENT_RUN_MODE", "only mock/mock-error mode is supported", 400);
  }
  return {
    taskId: body.taskId,
    employeeId: typeof body.employeeId === "string" ? body.employeeId : undefined,
    mode: body.mode === "mock-error" ? "mock-error" : "mock",
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

  const agent = getAgentMetadata(employeeId);
  if (!agent) throw new AgentEventError("AGENT_NOT_REGISTERED", `agent is not registered: ${employeeId}`, 400);

  const runId = `run-${randomUUID()}`;
  const context = {
    runId,
    task: {
      id: task.id,
      title: task.title,
      description: task.description,
      department: task.department,
      status: task.status,
      currentStep: task.currentStep,
      nextAction: task.nextAction,
      assignedEmployeeId: task.assignedEmployeeId,
    },
    employee: {
      id: employee.id,
      displayName: employee.displayName,
      department: employee.department,
    },
    agent,
  };
  const plan = createMockAgentRunPlan(context);
  await createAgentRun({
    id: runId,
    taskId: task.id,
    employeeId,
    mode: request.mode ?? "mock",
    status: "running",
    triggerSource: "user",
    startedAt: new Date(),
    metadata: {
      taskTitle: task.title,
      agentDisplayName: agent.displayName,
      department: agent.department,
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
      summary: `${agent.displayName} Agent가 업무 실행을 시작했습니다.`,
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
      summary: `${agent.displayName} Agent가 ${task.title} 업무를 수행 중입니다.`,
    },
  }));
  await wait(150);

  events.push(await emit({
    source: "mock",
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
        summary: `${agent.displayName} Agent가 업무 실행을 마쳤습니다.`,
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
      agentDisplayName: agent.displayName,
      outputTitle: plan.outputTitle,
      approvalId: approvalId ?? null,
      eventCount: events.length,
    },
  });

  return {
    ok: true,
    runId,
    taskId: task.id,
    employeeId,
    status: "succeeded",
    mode: request.mode ?? "mock",
    events,
    approvalId,
    resultSummary,
  };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown mock agent run error";
    await emit({
      source: "mock",
      eventType: "ErrorOccurred",
      employeeId,
      taskId: task.id,
      payload: {
        runId,
        summary: `${agent.displayName} Agent 실행 실패`,
        error: message,
      },
    }).catch(() => null);
    await updateAgentRunStatus({
      id: runId,
      status: "failed",
      completedAt: new Date(),
      errorMessage: message,
      metadata: {
        taskTitle: task.title,
        agentDisplayName: agent.displayName,
        eventCount: events.length,
      },
    });
    throw new AgentEventError("AGENT_RUN_MOCK_FAILED", message, 500);
  }
}
