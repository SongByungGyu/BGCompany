import type { BGCompanyEvent } from "@/features/events/types";
import type { WorkBoardEmployee } from "@/features/work-board/work-board-types";

export type ApprovalStatus = "승인 대기" | "승인 완료" | "반려" | "수정 요청" | "보류";
export type ApprovalRisk = "낮음" | "보통" | "높음";

export type ApprovalRequest = {
  id: string;
  title: string;
  employeeId: string;
  type: "콘텐츠" | "비용" | "오류" | "운영";
  risk: ApprovalRisk;
  estimatedCost: string;
  status: ApprovalStatus;
  requestedAt: string;
  relatedTaskId: string;
  reason: string;
  plannedAction: string;
  expectedResult: string;
  output: string;
};

export type ApprovalInboxProps = {
  employees: WorkBoardEmployee[];
  eventLog: BGCompanyEvent[];
  onPublishEvent: (event: BGCompanyEvent, focus?: boolean) => void;
};
