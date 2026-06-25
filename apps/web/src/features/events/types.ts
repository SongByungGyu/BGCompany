export type BGEmployeeStatus =
  | "대기 중"
  | "업무 중"
  | "조사 중"
  | "회의 중"
  | "검토 중"
  | "결과 대기"
  | "승인 대기"
  | "수정 중"
  | "보고 중"
  | "오류 대응 중"
  | "업무 완료"
  | "휴식 중"
  | "업무 종료";

export type BGCompanyEventBase<TType extends string, TPayload extends Record<string, unknown>> = {
  id: string;
  type: TType;
  timestamp: string;
  employeeId?: string;
  taskId?: string;
  payload: TPayload;
};

export type TaskCreatedEvent = BGCompanyEventBase<"TaskCreated", {
  title: string;
  description?: string;
}>;

export type TaskStartedEvent = BGCompanyEventBase<"TaskStarted", {
  title?: string;
  next?: string;
}>;

export type EmployeeStatusChangedEvent = BGCompanyEventBase<"EmployeeStatusChanged", {
  status: BGEmployeeStatus;
  reason?: string;
}>;

export type MeetingStartedEvent = BGCompanyEventBase<"MeetingStarted", {
  meetingTitle: string;
  participants?: string[];
}>;

export type MeetingEndedEvent = BGCompanyEventBase<"MeetingEnded", {
  meetingTitle: string;
  nextStatus?: BGEmployeeStatus;
  summary?: string;
}>;

export type ApprovalRequestedEvent = BGCompanyEventBase<"ApprovalRequested", {
  title: string;
  approverId?: string;
}>;

export type ApprovalResolvedEvent = BGCompanyEventBase<"ApprovalResolved", {
  approved: boolean;
  title: string;
  comment?: string;
}>;

export type ErrorOccurredEvent = BGCompanyEventBase<"ErrorOccurred", {
  title: string;
  message: string;
}>;

export type ErrorResolvedEvent = BGCompanyEventBase<"ErrorResolved", {
  title: string;
  resolution?: string;
  nextStatus?: BGEmployeeStatus;
}>;

export type OutputGeneratedEvent = BGCompanyEventBase<"OutputGenerated", {
  title: string;
  output: string;
  outputMeta?: string;
  nextStatus?: BGEmployeeStatus;
}>;

export type EmployeeMovedEvent = BGCompanyEventBase<"EmployeeMoved", {
  destinationId: string;
  status?: BGEmployeeStatus;
  reason?: string;
}>;

export type BGCompanyEvent =
  | TaskCreatedEvent
  | TaskStartedEvent
  | EmployeeStatusChangedEvent
  | MeetingStartedEvent
  | MeetingEndedEvent
  | ApprovalRequestedEvent
  | ApprovalResolvedEvent
  | ErrorOccurredEvent
  | ErrorResolvedEvent
  | OutputGeneratedEvent
  | EmployeeMovedEvent;

export type BGTimelineEntry = {
  id: string;
  eventId: string;
  employeeId?: string;
  employeeName?: string;
  timestamp: string;
  eventType: BGCompanyEvent["type"];
  status?: BGEmployeeStatus;
  taskTitle?: string;
  description: string;
  group: "working" | "meeting" | "waiting" | "error" | "done" | "idle";
};
