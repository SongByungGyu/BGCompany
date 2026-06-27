export type AgentEventSource = "hermes" | "mock" | "system" | "codex" | "manual";

export type AgentEventInput = {
  source: AgentEventSource;
  eventType: string;
  employeeId?: string;
  taskId?: string;
  approvalId?: string;
  timestamp?: string;
  payload?: Record<string, unknown>;
};

export type AgentEventNormalizedType =
  | "TaskCreated"
  | "TaskStarted"
  | "EmployeeStatusChanged"
  | "MeetingStarted"
  | "MeetingEnded"
  | "ApprovalRequested"
  | "ApprovalResolved"
  | "ErrorOccurred"
  | "ErrorResolved"
  | "OutputGenerated"
  | "EmployeeMoved";

export type NormalizedAgentEvent = {
  source: AgentEventSource;
  type: AgentEventNormalizedType;
  timestamp: string;
  employeeId?: string;
  taskId?: string;
  approvalId?: string;
  payload: Record<string, unknown>;
  summary: string;
  participantEmployeeIds: string[];
};

export type AgentEventProcessResult = {
  ok: true;
  eventId: string;
  eventIds: string[];
  normalizedType: AgentEventNormalizedType;
  sideEffects: {
    employeeUpdated: boolean;
    taskUpdated: boolean;
    approvalUpdated: boolean;
    timelineCreated: boolean;
  };
};

export class AgentEventError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
