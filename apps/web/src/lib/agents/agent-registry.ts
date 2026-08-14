import type { AgentMetadata } from "./agent-context-types";

export const agentRegistry: Record<string, AgentMetadata> = {
  "director": {
    agentId: "director",
    displayName: "루나",
    department: "대표실",
    defaultSeat: "director-seat",
    allowedEvents: ["EmployeeStatusChanged", "ApprovalRequested", "ApprovalResolved", "MeetingStarted", "MeetingEnded", "OutputGenerated"],
    execution: {
      defaultMode: "policy",
      availableModes: ["policy"],
      label: "정책 엔진",
      scope: "사전 승인된 운영 정책 적용과 CEO 예외 승인 분류",
    },
  },
  "content-planner": {
    agentId: "content-planner",
    displayName: "미나",
    department: "콘텐츠팀",
    defaultSeat: "content-seat-01",
    allowedEvents: ["TaskStarted", "EmployeeStatusChanged", "OutputGenerated", "ApprovalRequested"],
    execution: {
      defaultMode: "hermes",
      availableModes: ["hermes", "mock"],
      label: "Hermes · Mock 보조",
      scope: "주식 블로그는 Hermes, 공통 오피스 시나리오는 Mock",
    },
  },
  "marketing-manager": {
    agentId: "marketing-manager",
    displayName: "카이",
    department: "콘텐츠팀",
    defaultSeat: "content-seat-02",
    allowedEvents: ["TaskStarted", "EmployeeStatusChanged", "OutputGenerated", "ApprovalRequested"],
    execution: {
      defaultMode: "hermes",
      availableModes: ["hermes", "mock"],
      label: "Hermes · Mock 보조",
      scope: "주식 블로그는 Hermes, 공통 오피스 시나리오는 Mock",
    },
  },
  "content-writer": {
    agentId: "content-writer",
    displayName: "지아",
    department: "콘텐츠팀",
    defaultSeat: "content-seat-03",
    allowedEvents: ["TaskStarted", "EmployeeStatusChanged", "OutputGenerated", "ApprovalRequested"],
    execution: {
      defaultMode: "hermes",
      availableModes: ["hermes", "mock"],
      label: "Hermes · Mock 보조",
      scope: "주식 블로그는 Hermes, 공통 오피스 시나리오는 Mock",
    },
  },
  "finance-manager": {
    agentId: "finance-manager",
    displayName: "도윤",
    department: "재정팀",
    defaultSeat: "finance-seat-01",
    allowedEvents: ["TaskStarted", "EmployeeStatusChanged", "OutputGenerated", "ApprovalRequested"],
    execution: {
      defaultMode: "mock",
      availableModes: ["mock"],
      label: "Mock 실행기",
      scope: "재정 Agent 업무 실행은 Mock이며 재정 화면의 공급자 조회와는 분리",
    },
  },
  "stock-monitor": {
    agentId: "stock-monitor",
    displayName: "서준",
    department: "주식팀",
    defaultSeat: "stock-seat-01",
    allowedEvents: ["TaskStarted", "EmployeeStatusChanged", "OutputGenerated", "ApprovalRequested"],
    execution: {
      defaultMode: "rules",
      availableModes: ["rules", "mock"],
      label: "규칙 · Provider",
      scope: "시장·레퍼런스 수집과 사전검증은 규칙/Provider, 공통 시나리오는 Mock",
    },
  },
  "risk-trader": {
    agentId: "risk-trader",
    displayName: "민서",
    department: "주식팀",
    defaultSeat: "stock-seat-02",
    allowedEvents: ["TaskStarted", "EmployeeStatusChanged", "OutputGenerated", "ApprovalRequested"],
    execution: {
      defaultMode: "rules",
      availableModes: ["rules", "mock"],
      label: "규칙 · 모의투자",
      scope: "읽기 전용 리스크 판단과 Paper Trading만 허용",
    },
  },
  "execution-trader": {
    agentId: "execution-trader",
    displayName: "태오",
    department: "주식팀",
    defaultSeat: "stock-seat-03",
    allowedEvents: ["TaskStarted", "EmployeeStatusChanged", "OutputGenerated", "ApprovalRequested", "ErrorOccurred"],
    execution: {
      defaultMode: "rules",
      availableModes: ["rules", "mock"],
      label: "규칙 · 모의투자",
      scope: "Paper Trading 체결 시뮬레이션만 허용하고 실계좌 주문은 금지",
    },
  },
  "developer": {
    agentId: "developer",
    displayName: "하늘",
    department: "개발팀",
    defaultSeat: "dev-seat-01",
    allowedEvents: ["TaskStarted", "EmployeeStatusChanged", "ErrorOccurred", "ErrorResolved", "OutputGenerated", "ApprovalRequested"],
    execution: {
      defaultMode: "mock",
      availableModes: ["mock"],
      label: "Mock 실행기",
      scope: "현재 공통 Agent runner의 개발 업무 시뮬레이션",
    },
  },
  "qa-auditor": {
    agentId: "qa-auditor",
    displayName: "윤아",
    department: "지식·감사",
    defaultSeat: "audit-seat-01",
    allowedEvents: ["TaskStarted", "EmployeeStatusChanged", "MeetingStarted", "MeetingEnded", "OutputGenerated"],
    execution: {
      defaultMode: "hermes",
      availableModes: ["hermes", "rules", "mock"],
      label: "Hermes · 규칙 게이트",
      scope: "주식 블로그 문맥 검토는 Hermes, 게시 차단은 결정론적 품질 게이트",
    },
  },
};

export function getAgentMetadata(agentId: string) {
  return agentRegistry[agentId];
}

export function getAgentExecutionLabel(agentId: string) {
  return getAgentMetadata(agentId)?.execution.label ?? "실행 방식 미지정";
}
