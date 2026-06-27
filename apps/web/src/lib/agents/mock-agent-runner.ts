import type { AgentRunContext, MockAgentRunPlan } from "./agent-runner-types";

const approvalKeywords = ["승인", "게시", "비용", "배포", "핫픽스", "외부", "민감", "결제"];

function taskText(context: AgentRunContext) {
  return [
    context.task.title,
    context.task.description,
    context.task.currentStep,
    context.task.nextAction,
    context.task.status,
  ].filter(Boolean).join(" ");
}

function inferApprovalType(context: AgentRunContext) {
  if (context.employee.id === "finance-manager" || context.task.department.includes("재정")) return "비용";
  if (context.employee.id === "developer" || context.task.department.includes("개발")) return "오류";
  if (context.employee.id === "marketing-manager" || context.task.department.includes("콘텐츠")) return "콘텐츠";
  return "운영";
}

function outputTitleFor(context: AgentRunContext) {
  switch (context.employee.id) {
    case "content-planner":
      return "콘텐츠 기획안 초안 생성";
    case "marketing-manager":
      return "제목/홍보 문구 제안 생성";
    case "finance-manager":
      return "비용 요약 리포트 생성";
    case "stock-monitor":
      return "보유 종목 리스크 요약 생성";
    case "developer":
      return "오류 분석 결과 생성";
    case "qa-auditor":
      return "QA 검토 결과 생성";
    case "director":
      return "경영 판단 메모 생성";
    default:
      return "Agent 실행 결과 생성";
  }
}

function finalStatusFor(context: AgentRunContext, requiresApproval: boolean) {
  if (requiresApproval) return "승인 대기";
  if (context.employee.id === "stock-monitor") return "결과 대기";
  return "업무 완료";
}

export function createMockAgentRunPlan(context: AgentRunContext): MockAgentRunPlan {
  const text = taskText(context);
  const requiresApproval = context.task.status === "승인 대기" || approvalKeywords.some((keyword) => text.includes(keyword));
  const approvalType = inferApprovalType(context);
  return {
    summary: `${context.agent.displayName} Agent가 ${context.task.title} 업무를 mock으로 실행했습니다.`,
    outputTitle: outputTitleFor(context),
    finalStatus: finalStatusFor(context, requiresApproval),
    requiresApproval,
    approvalType,
    approvalRisk: approvalType === "오류" ? "높음" : "보통",
    approvalReason: `${context.task.title} 결과를 적용하기 전 대표 확인이 필요합니다.`,
  };
}
