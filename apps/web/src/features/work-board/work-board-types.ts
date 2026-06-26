import type { BGCompanyEvent, BGEmployeeStatus } from "@/features/events/types";

export type WorkTaskStatus = "대기" | "진행 중" | "승인 대기" | "오류" | "완료";
export type WorkTaskPriority = "낮음" | "보통" | "높음";

export type WorkBoardEmployee = {
  id: string;
  name: string;
  initial: string;
  department: string;
  status: BGEmployeeStatus;
  group: "working" | "meeting" | "waiting" | "error" | "done" | "idle";
  task: string;
  progress: number;
  started: string;
  model: string;
  cost: string;
  output: string;
  outputMeta: string;
  next: string;
  error?: string;
};

export type WorkTaskStep = {
  label: string;
  done: boolean;
};

export type WorkTask = {
  id: string;
  title: string;
  assigneeId: string;
  department: string;
  status: WorkTaskStatus;
  priority: WorkTaskPriority;
  progress: number;
  started: string;
  model: string;
  cost: string;
  purpose: string;
  currentStep: string;
  steps: WorkTaskStep[];
  approvalRequired: boolean;
  error?: string;
  output?: string;
  nextAction: string;
};

export type WorkBoardProps = {
  employees: WorkBoardEmployee[];
  eventLog: BGCompanyEvent[];
  onPublishEvent: (event: BGCompanyEvent, focus?: boolean) => void;
};
