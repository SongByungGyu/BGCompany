import type { WorkTask } from "./work-board-types";
import { mapTaskRecordToWorkTask, type TaskRecord } from "./mappers";

export type AgentRunRecord = {
  id: string;
  taskId: string | null;
  employeeId: string;
  mode: string;
  status: string;
  triggerSource: string;
  startedAt: string | null;
  completedAt: string | null;
  resultSummary: string | null;
  errorMessage: string | null;
  hermesJobId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
};

export type AgentRunResponse = {
  ok: true;
  runId: string;
  taskId: string;
  employeeId: string;
  status: "succeeded";
  mode: "mock" | "mock-error";
  approvalId?: string;
  resultSummary: string;
};

export async function fetchWorkTasks(): Promise<WorkTask[]> {
  const response = await fetch("/api/tasks", { cache: "no-store" });
  if (!response.ok) throw new Error(`Failed to fetch tasks: ${response.status}`);
  const data = await response.json() as { tasks?: TaskRecord[] };
  return (data.tasks ?? []).map(mapTaskRecordToWorkTask);
}

export async function fetchAgentRuns(input: { taskId?: string; employeeId?: string; status?: string } = {}): Promise<AgentRunRecord[]> {
  const params = new URLSearchParams();
  if (input.taskId) params.set("taskId", input.taskId);
  if (input.employeeId) params.set("employeeId", input.employeeId);
  if (input.status) params.set("status", input.status);
  const query = params.toString();
  const response = await fetch(`/api/agent-runs${query ? `?${query}` : ""}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`Failed to fetch agent runs: ${response.status}`);
  const data = await response.json() as { agentRuns?: AgentRunRecord[] };
  return data.agentRuns ?? [];
}

export async function runAgentTask(input: { taskId: string; employeeId?: string; mode?: "mock" | "mock-error" }): Promise<AgentRunResponse> {
  const response = await fetch("/api/agent-runs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) throw new Error(`Failed to run agent task: ${response.status}`);
  return response.json() as Promise<AgentRunResponse>;
}
