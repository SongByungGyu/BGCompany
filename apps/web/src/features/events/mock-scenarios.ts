import { createBGCompanyEvent } from "./bg-company-events";
import type { BGCompanyEvent } from "./types";

export type MockScenarioStep = {
  delayMs: number;
  event: BGCompanyEvent;
};

export type MockScenarioDefinition = {
  id: "content-meeting" | "approval-request" | "error-response" | "break-time";
  label: string;
};

export const mockScenarioDefinitions: MockScenarioDefinition[] = [
  { id: "content-meeting", label: "콘텐츠 회의" },
  { id: "approval-request", label: "승인 요청" },
  { id: "error-response", label: "오류 대응" },
  { id: "break-time", label: "휴식" },
];

export function createMockScenarioSteps(scenarioId: MockScenarioDefinition["id"]): MockScenarioStep[] {
  if (scenarioId === "content-meeting") {
    return [
      { delayMs: 0, event: createBGCompanyEvent("MeetingStarted", { employeeId: "content-planner", taskId: "content-sync", payload: { meetingTitle: "콘텐츠 회의", participants: ["content-planner", "finance-manager", "qa-auditor"] } }) },
      { delayMs: 500, event: createBGCompanyEvent("MeetingStarted", { employeeId: "finance-manager", taskId: "content-sync", payload: { meetingTitle: "콘텐츠 회의", participants: ["content-planner", "finance-manager", "qa-auditor"] } }) },
      { delayMs: 1000, event: createBGCompanyEvent("MeetingStarted", { employeeId: "qa-auditor", taskId: "content-sync", payload: { meetingTitle: "콘텐츠 회의", participants: ["content-planner", "finance-manager", "qa-auditor"] } }) },
      { delayMs: 6000, event: createBGCompanyEvent("MeetingEnded", { employeeId: "content-planner", taskId: "content-sync", payload: { meetingTitle: "콘텐츠 회의", nextStatus: "업무 중", summary: "초안 방향 확정" } }) },
      { delayMs: 6400, event: createBGCompanyEvent("MeetingEnded", { employeeId: "finance-manager", taskId: "content-sync", payload: { meetingTitle: "콘텐츠 회의", nextStatus: "업무 중", summary: "비용 검토 완료" } }) },
      { delayMs: 6800, event: createBGCompanyEvent("MeetingEnded", { employeeId: "qa-auditor", taskId: "content-sync", payload: { meetingTitle: "콘텐츠 회의", nextStatus: "업무 완료", summary: "품질 기준 확인 완료" } }) },
    ];
  }

  if (scenarioId === "approval-request") {
    return [
      { delayMs: 0, event: createBGCompanyEvent("ApprovalRequested", { employeeId: "marketing-manager", taskId: "thumbnail-approval", payload: { title: "유튜브 썸네일 3종 승인 요청", approverId: "director" } }) },
    ];
  }

  if (scenarioId === "error-response") {
    return [
      { delayMs: 0, event: createBGCompanyEvent("ErrorOccurred", { employeeId: "developer", taskId: "deploy-pipeline", payload: { title: "배포 파이프라인 오류", message: "빌드 단계 exit code 1 감지" } }) },
      { delayMs: 5500, event: createBGCompanyEvent("ErrorResolved", { employeeId: "developer", taskId: "deploy-pipeline", payload: { title: "배포 파이프라인 오류", resolution: "캐시 재생성 후 빌드 복구", nextStatus: "업무 중" } }) },
    ];
  }

  return [
    { delayMs: 0, event: createBGCompanyEvent("EmployeeStatusChanged", { employeeId: "stock-monitor", taskId: "market-watch", payload: { status: "휴식 중", reason: "집중 모니터링 후 휴식" } }) },
    { delayMs: 5500, event: createBGCompanyEvent("TaskStarted", { employeeId: "stock-monitor", taskId: "market-watch", payload: { title: "관심 종목 장중 변동 모니터링", next: "대표 보고 준비" } }) },
  ];
}
