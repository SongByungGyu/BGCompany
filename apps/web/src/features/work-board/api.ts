import type { WorkTask } from "./work-board-types";
import { mapTaskRecordToWorkTask, type TaskRecord } from "./mappers";

export type AgentRunResponse = {
  ok: true;
  runId: string;
  taskId: string;
  employeeId: string;
  status: "completed";
  mode: "mock";
  approvalId?: string;
};

export async function fetchWorkTasks(): Promise<WorkTask[]> {
  const response = await fetch("/api/tasks", { cache: "no-store" });
  if (!response.ok) throw new Error(`Failed to fetch tasks: ${response.status}`);
  const data = await response.json() as { tasks?: TaskRecord[] };
  return (data.tasks ?? []).map(mapTaskRecordToWorkTask);
}

export async function runAgentTask(input: { taskId: string; employeeId?: string; mode?: "mock" }): Promise<AgentRunResponse> {
  const response = await fetch("/api/agent-runs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) throw new Error(`Failed to run agent task: ${response.status}`);
  return response.json() as Promise<AgentRunResponse>;
}
