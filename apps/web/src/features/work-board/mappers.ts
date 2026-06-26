import { mockWorkTasks } from "./mock-tasks";
import type { WorkTask, WorkTaskStatus } from "./work-board-types";

export type TaskRecord = {
  id: string;
  title: string;
  description: string | null;
  department: string;
  assignedEmployeeId: string | null;
  status: string;
  progress: number;
  startedAt: string | null;
  completedAt: string | null;
  model: string | null;
  cost: string | null;
  currentStep: string | null;
  recentOutput: string | null;
  nextAction: string | null;
  error: string | null;
};

function normalizeTaskStatus(status: string): WorkTaskStatus {
  if (status === "승인 대기") return "승인 대기";
  if (status === "오류") return "오류";
  if (status === "완료" || status === "업무 완료") return "완료";
  if (status === "대기" || status === "대기 중" || status === "업무 종료") return "대기";
  return "진행 중";
}

function formatStartedAt(value: string | null) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value));
}

function formatCost(value: string | null) {
  if (!value) return "$0.00";
  const numeric = Number(value);
  return Number.isFinite(numeric) ? `$${numeric.toFixed(2)}` : `$${value}`;
}

export function mapTaskRecordToWorkTask(record: TaskRecord): WorkTask {
  const fallback = mockWorkTasks.find((task) => task.id === record.id);
  const status = normalizeTaskStatus(record.status);
  return {
    id: record.id,
    title: record.title,
    assigneeId: record.assignedEmployeeId ?? fallback?.assigneeId ?? "unassigned",
    department: record.department,
    status,
    priority: fallback?.priority ?? (status === "오류" || status === "승인 대기" ? "높음" : "보통"),
    progress: record.progress ?? fallback?.progress ?? 0,
    started: formatStartedAt(record.startedAt),
    model: record.model ?? fallback?.model ?? "미정",
    cost: formatCost(record.cost),
    purpose: record.description ?? fallback?.purpose ?? "업무 목적이 아직 정리되지 않았습니다.",
    currentStep: record.currentStep ?? fallback?.currentStep ?? "대기",
    steps: fallback?.steps ?? [
      { label: "업무 생성", done: true },
      { label: record.currentStep ?? "현재 단계", done: status === "완료" },
      { label: record.nextAction ?? "다음 행동", done: false },
    ],
    approvalRequired: fallback?.approvalRequired ?? status === "승인 대기",
    error: record.error ?? fallback?.error,
    output: record.recentOutput ?? fallback?.output,
    nextAction: record.nextAction ?? fallback?.nextAction ?? "다음 행동 대기",
  };
}
