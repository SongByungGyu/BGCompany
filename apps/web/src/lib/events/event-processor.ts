import { prisma } from "@/lib/db";
import { createEvent } from "@/lib/repositories/events";
import type { AgentEventInput, AgentEventProcessResult, NormalizedAgentEvent } from "./agent-event-types";
import { AgentEventError } from "./agent-event-types";
import { normalizeAgentEvent } from "./event-normalizer";

async function assertExists(model: "employee" | "task" | "approval", id: string) {
  if (model === "employee") {
    const found = await prisma.employee.findUnique({ where: { id } });
    if (!found) throw new AgentEventError("EMPLOYEE_NOT_FOUND", `employeeId does not exist: ${id}`, 404);
  }
  if (model === "task") {
    const found = await prisma.task.findUnique({ where: { id } });
    if (!found) throw new AgentEventError("TASK_NOT_FOUND", `taskId does not exist: ${id}`, 404);
  }
  if (model === "approval") {
    const found = await prisma.approvalRequest.findUnique({ where: { id } });
    if (!found) throw new AgentEventError("APPROVAL_NOT_FOUND", `approvalId does not exist: ${id}`, 404);
  }
}

async function validateReferences(event: NormalizedAgentEvent) {
  if (event.employeeId) await assertExists("employee", event.employeeId);
  if (event.taskId) await assertExists("task", event.taskId);
  if (event.approvalId) await assertExists("approval", event.approvalId);
  for (const participantId of event.participantEmployeeIds) {
    await assertExists("employee", participantId);
  }
}

function eventPayload(event: NormalizedAgentEvent, participantId?: string) {
  return {
    ...event.payload,
    source: event.source,
    normalizedType: event.type,
    ...(participantId ? { participantId } : {}),
  };
}

async function persistOne(event: NormalizedAgentEvent, employeeId?: string) {
  return createEvent({
    type: event.type,
    timestamp: event.timestamp,
    employeeId: employeeId ?? event.employeeId ?? null,
    taskId: event.taskId ?? null,
    approvalId: event.approvalId ?? null,
    payload: eventPayload(event, employeeId),
    summary: event.summary,
  });
}

export async function processInternalEvent(input: {
  id?: string;
  type: string;
  timestamp?: string;
  employeeId?: string | null;
  taskId?: string | null;
  approvalId?: string | null;
  payload?: Record<string, unknown>;
  summary?: string | null;
}) {
  return createEvent(input);
}

export async function processAgentEvent(input: AgentEventInput): Promise<AgentEventProcessResult> {
  const normalized = normalizeAgentEvent(input);
  await validateReferences(normalized);

  const persistedEvents = normalized.participantEmployeeIds.length > 0 && (normalized.type === "MeetingStarted" || normalized.type === "MeetingEnded")
    ? await Promise.all(normalized.participantEmployeeIds.map((employeeId) => persistOne(normalized, employeeId)))
    : [await persistOne(normalized)];

  return {
    ok: true,
    eventId: persistedEvents[0].id,
    eventIds: persistedEvents.map((event) => event.id),
    normalizedType: normalized.type,
    sideEffects: {
      employeeUpdated: Boolean(normalized.employeeId || normalized.participantEmployeeIds.length > 0),
      taskUpdated: Boolean(normalized.taskId),
      approvalUpdated: Boolean(normalized.approvalId),
      timelineCreated: true,
    },
  };
}
