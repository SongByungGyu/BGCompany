import { mockApprovals } from "./mock-approvals";
import type { ApprovalRequest, ApprovalRisk, ApprovalStatus } from "./approval-types";

export type ApprovalRecord = {
  id: string;
  title: string;
  requestedByEmployeeId: string;
  taskId: string | null;
  approvalType: string;
  riskLevel: string;
  estimatedCost: string | null;
  status: string;
  reason: string | null;
  plannedAction: string | null;
  expectedResult: string | null;
  decision: string | null;
  decisionReason: string | null;
  decidedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

function normalizeStatus(status: string): ApprovalStatus {
  if (status === "승인 완료") return "승인 완료";
  if (status === "반려") return "반려";
  if (status === "수정 요청") return "수정 요청";
  if (status === "보류") return "보류";
  return "승인 대기";
}

function normalizeRisk(risk: string): ApprovalRisk {
  if (risk === "높음") return "높음";
  if (risk === "낮음") return "낮음";
  return "보통";
}

function normalizeType(type: string): ApprovalRequest["type"] {
  if (type === "비용" || type === "오류" || type === "운영") return type;
  return "콘텐츠";
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value));
}

function formatCost(value: string | null) {
  if (!value) return "$0.00";
  const numeric = Number(value);
  return Number.isFinite(numeric) ? `$${numeric.toFixed(2)}` : `$${value}`;
}

export function mapApprovalRecordToApprovalRequest(record: ApprovalRecord): ApprovalRequest {
  const fallback = mockApprovals.find((approval) => approval.id === record.id);
  return {
    id: record.id,
    title: record.title,
    employeeId: record.requestedByEmployeeId,
    type: normalizeType(record.approvalType),
    risk: normalizeRisk(record.riskLevel),
    estimatedCost: formatCost(record.estimatedCost),
    status: normalizeStatus(record.status),
    requestedAt: formatTime(record.createdAt),
    relatedTaskId: record.taskId ?? fallback?.relatedTaskId ?? "",
    reason: record.reason ?? fallback?.reason ?? "승인 요청 사유가 아직 정리되지 않았습니다.",
    plannedAction: record.plannedAction ?? fallback?.plannedAction ?? "승인 후 후속 작업을 진행합니다.",
    expectedResult: record.expectedResult ?? fallback?.expectedResult ?? "업무 진행 상태가 갱신됩니다.",
    output: fallback?.output ?? record.decisionReason ?? "DB 승인 요청",
  };
}
