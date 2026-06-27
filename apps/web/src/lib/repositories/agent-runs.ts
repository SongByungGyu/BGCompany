import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { serializeAgentRun } from "./serializers";

export type AgentRunStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

export async function createAgentRun(input: {
  id?: string;
  taskId?: string | null;
  employeeId: string;
  mode: string;
  status?: AgentRunStatus;
  triggerSource: string;
  startedAt?: Date | null;
  metadata?: Prisma.InputJsonValue;
}) {
  const run = await prisma.agentRun.create({
    data: {
      id: input.id,
      taskId: input.taskId ?? null,
      employeeId: input.employeeId,
      mode: input.mode,
      status: input.status ?? "queued",
      triggerSource: input.triggerSource,
      startedAt: input.startedAt ?? null,
      metadata: input.metadata,
    },
  });
  return serializeAgentRun(run);
}

export async function updateAgentRunStatus(input: {
  id: string;
  status: AgentRunStatus;
  completedAt?: Date | null;
  resultSummary?: string | null;
  errorMessage?: string | null;
  hermesJobId?: string | null;
  metadata?: Prisma.InputJsonValue;
}) {
  const run = await prisma.agentRun.update({
    where: { id: input.id },
    data: {
      status: input.status,
      completedAt: input.completedAt,
      resultSummary: input.resultSummary,
      errorMessage: input.errorMessage,
      hermesJobId: input.hermesJobId,
      metadata: input.metadata,
    },
  });
  return serializeAgentRun(run);
}

export async function getAgentRunById(id: string) {
  const run = await prisma.agentRun.findUnique({ where: { id } });
  return run ? serializeAgentRun(run) : null;
}

export async function getAgentRuns(input: {
  taskId?: string;
  employeeId?: string;
  status?: string;
} = {}) {
  const runs = await prisma.agentRun.findMany({
    where: {
      taskId: input.taskId,
      employeeId: input.employeeId,
      status: input.status,
    },
    orderBy: [{ createdAt: "desc" }],
    take: 100,
  });
  return runs.map(serializeAgentRun);
}

export function getAgentRunsByTaskId(taskId: string) {
  return getAgentRuns({ taskId });
}

export function getAgentRunsByEmployeeId(employeeId: string) {
  return getAgentRuns({ employeeId });
}
