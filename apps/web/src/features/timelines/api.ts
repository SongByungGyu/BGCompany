export type TimelineTargetType = "task" | "approval" | "employee" | "global";

export type TimelineEventRecord = {
  id: string;
  type: string;
  timestamp: string;
  employeeId: string | null;
  taskId: string | null;
  approvalId: string | null;
  payload: Record<string, unknown>;
  summary: string | null;
};

export type TimelineRecord = {
  id: string;
  targetType: string;
  targetId: string;
  eventId: string | null;
  title: string;
  description: string | null;
  timestamp: string;
  event?: TimelineEventRecord | null;
};

export async function fetchTimeline(input?: {
  targetType?: TimelineTargetType;
  targetId?: string;
}): Promise<TimelineRecord[]> {
  const params = new URLSearchParams();
  if (input?.targetType) params.set("targetType", input.targetType);
  if (input?.targetId) params.set("targetId", input.targetId);
  const query = params.toString();
  const response = await fetch(`/api/timelines${query ? `?${query}` : ""}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`Failed to fetch timeline: ${response.status}`);
  const data = await response.json() as { timelines?: TimelineRecord[] };
  return data.timelines ?? [];
}
