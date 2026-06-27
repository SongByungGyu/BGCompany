import type { AgentMetadata } from "./agent-context-types";

export const agentRegistry: Record<string, AgentMetadata> = {
  "director": {
    agentId: "director",
    displayName: "루나",
    department: "대표실",
    defaultSeat: "director-seat",
    allowedEvents: ["EmployeeStatusChanged", "ApprovalResolved", "MeetingStarted", "MeetingEnded", "OutputGenerated"],
  },
  "content-planner": {
    agentId: "content-planner",
    displayName: "미나",
    department: "콘텐츠팀",
    defaultSeat: "content-seat-01",
    allowedEvents: ["TaskStarted", "EmployeeStatusChanged", "OutputGenerated", "ApprovalRequested"],
  },
  "marketing-manager": {
    agentId: "marketing-manager",
    displayName: "카이",
    department: "콘텐츠팀",
    defaultSeat: "content-seat-02",
    allowedEvents: ["TaskStarted", "EmployeeStatusChanged", "OutputGenerated", "ApprovalRequested"],
  },
  "finance-manager": {
    agentId: "finance-manager",
    displayName: "도윤",
    department: "재정팀",
    defaultSeat: "finance-seat-01",
    allowedEvents: ["TaskStarted", "EmployeeStatusChanged", "OutputGenerated", "ApprovalRequested"],
  },
  "stock-monitor": {
    agentId: "stock-monitor",
    displayName: "서준",
    department: "주식팀",
    defaultSeat: "stock-seat-01",
    allowedEvents: ["TaskStarted", "EmployeeStatusChanged", "OutputGenerated", "ApprovalRequested"],
  },
  "developer": {
    agentId: "developer",
    displayName: "하늘",
    department: "개발팀",
    defaultSeat: "dev-seat-01",
    allowedEvents: ["TaskStarted", "EmployeeStatusChanged", "ErrorOccurred", "ErrorResolved", "OutputGenerated", "ApprovalRequested"],
  },
  "qa-auditor": {
    agentId: "qa-auditor",
    displayName: "윤아",
    department: "지식·감사",
    defaultSeat: "audit-seat-01",
    allowedEvents: ["TaskStarted", "EmployeeStatusChanged", "MeetingStarted", "MeetingEnded", "OutputGenerated"],
  },
};

export function getAgentMetadata(agentId: string) {
  return agentRegistry[agentId];
}
