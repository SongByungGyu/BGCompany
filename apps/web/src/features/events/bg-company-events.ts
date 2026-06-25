import type { BGCompanyEvent, BGEmployeeStatus } from "./types";

let eventSequence = 0;

export function createEventId(prefix: string) {
  eventSequence += 1;
  return `${prefix}-${Date.now()}-${eventSequence}`;
}

export function createBGCompanyEvent(
  type: BGCompanyEvent["type"],
  options: {
    employeeId?: string;
    taskId?: string;
    payload?: Record<string, unknown>;
    timestamp?: string;
  } = {},
): BGCompanyEvent {
  return {
    id: createEventId(type),
    type,
    timestamp: options.timestamp ?? new Date().toISOString(),
    employeeId: options.employeeId,
    taskId: options.taskId,
    payload: options.payload ?? {},
  } as BGCompanyEvent;
}

export function createStatusChangedEvent(employeeId: string, status: BGEmployeeStatus, reason?: string) {
  return createBGCompanyEvent("EmployeeStatusChanged", {
    employeeId,
    payload: { status, reason },
  });
}
