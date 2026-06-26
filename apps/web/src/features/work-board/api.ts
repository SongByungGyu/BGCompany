import type { WorkTask } from "./work-board-types";
import { mapTaskRecordToWorkTask, type TaskRecord } from "./mappers";

export async function fetchWorkTasks(): Promise<WorkTask[]> {
  const response = await fetch("/api/tasks", { cache: "no-store" });
  if (!response.ok) throw new Error(`Failed to fetch tasks: ${response.status}`);
  const data = await response.json() as { tasks?: TaskRecord[] };
  return (data.tasks ?? []).map(mapTaskRecordToWorkTask);
}
