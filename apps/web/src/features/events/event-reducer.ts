import type { BGCompanyEvent, BGEmployeeStatus, BGTimelineEntry } from "./types";

export type BGEmployeeGroup = "working" | "meeting" | "waiting" | "error" | "done" | "idle";

export type BGEmployeeSnapshot = {
  id: string;
  name: string;
  status: BGEmployeeStatus;
  group: BGEmployeeGroup;
  task: string;
  progress: number;
  output: string;
  outputMeta: string;
  next: string;
  error?: string;
};

export const eventStatusGroupMap: Record<BGEmployeeStatus, BGEmployeeGroup> = {
  "대기 중": "idle",
  "업무 중": "working",
  "조사 중": "waiting",
  "회의 중": "meeting",
  "검토 중": "working",
  "결과 대기": "waiting",
  "승인 대기": "waiting",
  "수정 중": "working",
  "보고 중": "working",
  "오류 대응 중": "error",
  "업무 완료": "done",
  "휴식 중": "idle",
  "업무 종료": "idle",
};

function payloadString(event: BGCompanyEvent, key: string) {
  const payload = event.payload as Record<string, unknown>;
  const value = payload[key];
  return typeof value === "string" ? value : undefined;
}

function payloadStatus(event: BGCompanyEvent, key: string) {
  return payloadString(event, key) as BGEmployeeStatus | undefined;
}

function resolveStatusFromEvent(event: BGCompanyEvent): BGEmployeeStatus | undefined {
  switch (event.type) {
    case "TaskStarted":
      return "업무 중";
    case "EmployeeStatusChanged":
      return payloadStatus(event, "status");
    case "MeetingStarted":
      return "회의 중";
    case "MeetingEnded":
      return payloadStatus(event, "nextStatus") ?? "업무 중";
    case "ApprovalRequested":
      return "승인 대기";
    case "ApprovalResolved":
      return event.payload.approved ? "업무 완료" : "수정 중";
    case "ErrorOccurred":
      return "오류 대응 중";
    case "ErrorResolved":
      return payloadStatus(event, "nextStatus") ?? "업무 중";
    case "OutputGenerated":
      return payloadStatus(event, "nextStatus") ?? "결과 대기";
    case "EmployeeMoved":
      return payloadStatus(event, "status");
    default:
      return undefined;
  }
}

function taskTitleFromEvent(event: BGCompanyEvent) {
  return payloadString(event, "title") ?? payloadString(event, "meetingTitle");
}

function nextTextFromStatus(status: BGEmployeeStatus, currentNext: string) {
  if (status === "회의 중") return "회의 후 업무 결과 정리";
  if (status === "승인 대기") return "대표 승인 필요";
  if (status === "오류 대응 중") return "오류 원인 분석 및 핫픽스 준비";
  if (status === "업무 완료") return "다음 업무 대기";
  if (status === "휴식 중") return "휴식 후 업무 복귀";
  if (status === "결과 대기") return "결과 검토 및 후속 작업 판단";
  return currentNext;
}

export function reduceEmployeesByEvent<TEmployee extends BGEmployeeSnapshot>(employees: TEmployee[], event: BGCompanyEvent) {
  if (!event.employeeId) return employees;
  const status = resolveStatusFromEvent(event);
  const taskTitle = taskTitleFromEvent(event);

  return employees.map((employee) => {
    if (employee.id !== event.employeeId) return employee;
    const nextStatus = status ?? employee.status;
    const output = payloadString(event, "output");
    const outputMeta = payloadString(event, "outputMeta");
    const errorMessage = payloadString(event, "message");
    return {
      ...employee,
      status: nextStatus,
      group: eventStatusGroupMap[nextStatus],
      task: taskTitle ?? employee.task,
      progress: nextStatus === "업무 완료" ? 100 : nextStatus === "업무 중" ? Math.max(employee.progress, 45) : employee.progress,
      output: output ?? employee.output,
      outputMeta: outputMeta ?? employee.outputMeta,
      next: nextTextFromStatus(nextStatus, employee.next),
      error: event.type === "ErrorOccurred" ? errorMessage : event.type === "ErrorResolved" ? undefined : employee.error,
    };
  });
}

function eventDescription(event: BGCompanyEvent, employeeName?: string, status?: BGEmployeeStatus) {
  const name = employeeName ?? "시스템";
  switch (event.type) {
    case "TaskCreated":
      return `${name}에게 새 업무가 생성됨`;
    case "TaskStarted":
      return `${name} 업무 시작`;
    case "EmployeeStatusChanged":
      return `${name} ${status ?? "상태"}로 변경`;
    case "MeetingStarted":
      return `${name} 회의 참여`;
    case "MeetingEnded":
      return `${name} 회의 종료`;
    case "ApprovalRequested":
      return `${name} 승인 요청`;
    case "ApprovalResolved":
      return `${name} 승인 ${(event.payload as Record<string, unknown>).approved ? "완료" : "반려"}`;
    case "ErrorOccurred":
      return `${name} 오류 대응 시작`;
    case "ErrorResolved":
      return `${name} 오류 해결`;
    case "OutputGenerated":
      return `${name} 결과물 생성`;
    case "EmployeeMoved":
      return `${name} 이동 이벤트`;
  }
}

export function createTimelineEntry(event: BGCompanyEvent, employee?: BGEmployeeSnapshot): BGTimelineEntry {
  const status = resolveStatusFromEvent(event) ?? employee?.status;
  return {
    id: `timeline-${event.id}`,
    eventId: event.id,
    employeeId: event.employeeId,
    employeeName: employee?.name,
    timestamp: event.timestamp,
    eventType: event.type,
    status,
    taskTitle: taskTitleFromEvent(event) ?? employee?.task,
    description: eventDescription(event, employee?.name, status),
    group: eventStatusGroupMap[status ?? "대기 중"],
  };
}

export function appendTimelineEntry(
  timelineByEmployeeId: Record<string, BGTimelineEntry[]>,
  event: BGCompanyEvent,
  employees: BGEmployeeSnapshot[],
) {
  if (!event.employeeId) return timelineByEmployeeId;
  const employee = employees.find((item) => item.id === event.employeeId);
  const entry = createTimelineEntry(event, employee);
  return {
    ...timelineByEmployeeId,
    [event.employeeId]: [entry, ...(timelineByEmployeeId[event.employeeId] ?? [])].slice(0, 30),
  };
}
