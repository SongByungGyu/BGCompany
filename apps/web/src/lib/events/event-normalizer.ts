import type { AgentEventNormalizedType, AgentEventSource, NormalizedAgentEvent } from "./agent-event-types";
import { AgentEventError } from "./agent-event-types";

const sources = new Set<AgentEventSource>(["hermes", "mock", "system", "codex", "manual"]);
const supportedTypes = new Set<AgentEventNormalizedType>([
  "TaskCreated",
  "TaskStarted",
  "EmployeeStatusChanged",
  "MeetingStarted",
  "MeetingEnded",
  "ApprovalRequested",
  "ApprovalResolved",
  "ErrorOccurred",
  "ErrorResolved",
  "OutputGenerated",
  "EmployeeMoved",
]);

const aliases: Record<string, AgentEventNormalizedType> = {
  "task.created": "TaskCreated",
  "task.started": "TaskStarted",
  "employee.status.changed": "EmployeeStatusChanged",
  "employee.status_changed": "EmployeeStatusChanged",
  "employee_status_changed": "EmployeeStatusChanged",
  "meeting.started": "MeetingStarted",
  "meeting.ended": "MeetingEnded",
  "approval.requested": "ApprovalRequested",
  "approval.resolved": "ApprovalResolved",
  "error.occurred": "ErrorOccurred",
  "error.resolved": "ErrorResolved",
  "output.generated": "OutputGenerated",
  "employee.moved": "EmployeeMoved",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeType(eventType: string): AgentEventNormalizedType {
  if (supportedTypes.has(eventType as AgentEventNormalizedType)) return eventType as AgentEventNormalizedType;
  const lowered = eventType.trim().toLowerCase();
  const aliased = aliases[lowered] ?? aliases[lowered.replaceAll("-", ".")];
  if (aliased) return aliased;
  throw new AgentEventError("UNSUPPORTED_AGENT_EVENT", `Unsupported eventType: ${eventType}`, 400);
}

function stringValue(payload: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return undefined;
}

function booleanValue(payload: Record<string, unknown>, key: string) {
  const value = payload[key];
  return typeof value === "boolean" ? value : undefined;
}

function arrayStringValue(payload: Record<string, unknown>, key: string) {
  const value = payload[key];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
}

function summaryFor(type: AgentEventNormalizedType, payload: Record<string, unknown>) {
  return stringValue(payload, "summary", "title", "meetingTitle", "reason", "outputTitle", "output", "error", "message") ?? type;
}

export function normalizeAgentEvent(input: unknown): NormalizedAgentEvent {
  if (!isRecord(input)) throw new AgentEventError("INVALID_AGENT_EVENT", "request body must be a JSON object", 400);
  if (typeof input.source !== "string" || !sources.has(input.source as AgentEventSource)) {
    throw new AgentEventError("INVALID_AGENT_EVENT", "source is required and must be one of hermes/mock/system/codex/manual", 400);
  }
  if (typeof input.eventType !== "string" || !input.eventType.trim()) {
    throw new AgentEventError("INVALID_AGENT_EVENT", "eventType is required", 400);
  }

  const type = normalizeType(input.eventType);
  const payload = isRecord(input.payload) ? { ...input.payload } : {};
  const employeeId = typeof input.employeeId === "string" && input.employeeId.trim()
    ? input.employeeId
    : typeof payload.employeeId === "string" && payload.employeeId.trim()
      ? payload.employeeId
      : undefined;
  const taskId = typeof input.taskId === "string" && input.taskId.trim()
    ? input.taskId
    : typeof payload.taskId === "string" && payload.taskId.trim()
      ? payload.taskId
      : undefined;
  const approvalId = typeof input.approvalId === "string" && input.approvalId.trim()
    ? input.approvalId
    : typeof payload.approvalId === "string" && payload.approvalId.trim()
      ? payload.approvalId
      : undefined;
  const timestamp = typeof input.timestamp === "string" && input.timestamp.trim() ? input.timestamp : new Date().toISOString();
  const participantEmployeeIds = Array.from(new Set([employeeId, ...arrayStringValue(payload, "participants"), ...arrayStringValue(payload, "participantEmployeeIds")].filter((id): id is string => Boolean(id))));

  if (type === "EmployeeStatusChanged" && !employeeId) throw new AgentEventError("INVALID_AGENT_EVENT", "employeeId is required for EmployeeStatusChanged", 400);
  if (type === "EmployeeStatusChanged" && typeof payload.status !== "string") throw new AgentEventError("INVALID_AGENT_EVENT", "payload.status is required for EmployeeStatusChanged", 400);
  if (type === "TaskStarted" && !taskId) throw new AgentEventError("INVALID_AGENT_EVENT", "taskId is required for TaskStarted", 400);
  if (type === "ApprovalRequested" && !approvalId && !taskId) throw new AgentEventError("INVALID_AGENT_EVENT", "approvalId or taskId is required for ApprovalRequested", 400);
  if (type === "ApprovalResolved" && !approvalId) throw new AgentEventError("INVALID_AGENT_EVENT", "approvalId is required for ApprovalResolved", 400);
  if (type === "ErrorOccurred" && !employeeId && !taskId) throw new AgentEventError("INVALID_AGENT_EVENT", "employeeId or taskId is required for ErrorOccurred", 400);
  if (type === "OutputGenerated" && !taskId) throw new AgentEventError("INVALID_AGENT_EVENT", "taskId is required for OutputGenerated", 400);
  if (type === "EmployeeMoved" && !employeeId) throw new AgentEventError("INVALID_AGENT_EVENT", "employeeId is required for EmployeeMoved", 400);
  if ((type === "MeetingStarted" || type === "MeetingEnded") && participantEmployeeIds.length === 0) {
    throw new AgentEventError("INVALID_AGENT_EVENT", "employeeId or payload.participants is required for meeting events", 400);
  }

  if (type === "ErrorOccurred") {
    payload.message = stringValue(payload, "message", "error", "summary") ?? "Agent error occurred";
    payload.title = stringValue(payload, "title", "summary") ?? "Agent 오류";
  }
  if (type === "OutputGenerated") {
    payload.output = stringValue(payload, "output", "outputTitle", "summary") ?? "Agent output generated";
    payload.title = stringValue(payload, "title", "outputTitle", "summary") ?? "결과물 생성";
  }
  if (type === "ApprovalResolved") {
    payload.approved = booleanValue(payload, "approved") ?? payload.status === "승인 완료";
    payload.title = stringValue(payload, "title", "summary") ?? "승인 처리";
  }
  if (type === "ApprovalRequested") {
    payload.title = stringValue(payload, "title", "summary") ?? "승인 요청";
    if (approvalId) payload.approvalId = approvalId;
  }
  if (type === "MeetingStarted" || type === "MeetingEnded") {
    payload.meetingTitle = stringValue(payload, "meetingTitle", "title", "summary") ?? "Agent 회의";
    payload.participants = participantEmployeeIds;
  }

  return {
    source: input.source as AgentEventSource,
    type,
    timestamp,
    employeeId,
    taskId,
    approvalId,
    payload,
    summary: summaryFor(type, payload),
    participantEmployeeIds,
  };
}
