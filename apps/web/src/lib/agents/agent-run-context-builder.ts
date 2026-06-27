import type { Employee, Task } from "@prisma/client";
import { loadAgentRoleDocument } from "./agent-role-loader";
import type { AgentRunContext, AgentRunContextSummary } from "./agent-context-types";

const supportedEvents = [
  "TaskCreated",
  "TaskStarted",
  "EmployeeStatusChanged",
  "MeetingStarted",
  "MeetingEnded",
  "ApprovalRequested",
  "ApprovalResolved",
  "ErrorOccurred",
  "ErrorResolved",
  "OutputGenerated",
  "EmployeeMoved",
];

const approvalKeywords = ["승인", "게시", "비용", "배포", "핫픽스", "외부", "민감", "결제", "송금", "매수", "매도"];

function textForApproval(task: Task, roleApprovalConditions: string[]) {
  return [
    task.title,
    task.description,
    task.status,
    task.currentStep,
    task.nextAction,
    ...roleApprovalConditions,
  ].filter(Boolean).join(" ");
}

function safetyRulesFor(agentId: string) {
  const base = ["실제 외부 API 실행, 결제, 거래, 배포, 삭제 작업은 수행하지 않고 이벤트와 결과 요약만 생성합니다."];
  if (agentId === "finance-manager") {
    return [...base, "송금/결제/자동이체/투자 실행/계좌 제어는 금지이며 비용 분석은 읽기 전용입니다."];
  }
  if (agentId === "stock-monitor") {
    return [...base, "매수/매도/주문 실행/투자 자금 이동은 금지이며 보유 종목 모니터링은 읽기 전용입니다."];
  }
  if (agentId === "content-planner" || agentId === "marketing-manager") {
    return [...base, "콘텐츠 게시와 외부 메시지 발송은 대표 승인 전 실행하지 않습니다."];
  }
  if (agentId === "developer") {
    return [...base, "오류 복구, 파일 변경, 배포 관련 작업은 승인 또는 별도 사용자 지시 없이 실제 실행하지 않습니다."];
  }
  if (agentId === "qa-auditor") {
    return [...base, "정책 위반, 안전 문제, 감사 로그 이슈는 결과에 명시적으로 보고합니다."];
  }
  return base;
}

export function buildAgentRunContext(input: {
  runId: string;
  task: Task;
  employee: Employee;
}): AgentRunContext {
  const agent = loadAgentRoleDocument(input.employee.id);
  const taskApprovalText = textForApproval(input.task, agent.approvalConditions);
  const requiresApproval = input.task.status === "승인 대기" || approvalKeywords.some((keyword) => taskApprovalText.includes(keyword));
  const readOnlyFinance = input.employee.id === "finance-manager";
  const readOnlyStocks = input.employee.id === "stock-monitor";
  const safetyRules = safetyRulesFor(input.employee.id);
  return {
    runId: input.runId,
    task: {
      id: input.task.id,
      title: input.task.title,
      description: input.task.description,
      department: input.task.department,
      status: input.task.status,
      assignedEmployeeId: input.task.assignedEmployeeId,
      currentStep: input.task.currentStep,
      recentOutput: input.task.recentOutput,
      nextAction: input.task.nextAction,
    },
    employee: {
      id: input.employee.id,
      displayName: input.employee.displayName,
      department: input.employee.department,
      status: input.employee.status,
    },
    agent,
    constraints: {
      requiresApproval,
      forbiddenActions: agent.forbiddenActions,
      readOnlyFinance,
      readOnlyStocks,
      safetyRules,
    },
    eventContract: {
      endpoint: "/api/agent-events",
      supportedEvents,
    },
    outputFormat: agent.outputFormat,
    callback: {
      agentEventsEndpoint: "/api/agent-events",
    },
    metadata: {
      roleSummary: agent.roleSummary,
      approvalConditions: agent.approvalConditions,
      reportingRules: agent.reportingRules,
    },
  };
}

export function summarizeAgentRunContext(context: AgentRunContext): AgentRunContextSummary {
  return {
    runId: context.runId,
    taskId: context.task.id,
    taskTitle: context.task.title,
    employeeId: context.employee.id,
    agentId: context.agent.agentId,
    displayName: context.agent.displayName,
    department: context.agent.department,
    allowedEvents: context.agent.allowedEvents,
    forbiddenActions: context.constraints.forbiddenActions,
    requiresApproval: context.constraints.requiresApproval,
    readOnlyFinance: context.constraints.readOnlyFinance,
    readOnlyStocks: context.constraints.readOnlyStocks,
    safetyRules: context.constraints.safetyRules,
    outputFormat: context.outputFormat,
    reportingRules: context.agent.reportingRules,
    eventEndpoint: context.eventContract.endpoint,
  };
}
