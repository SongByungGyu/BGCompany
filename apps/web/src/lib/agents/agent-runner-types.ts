import type { AgentEventProcessResult } from "@/lib/events/agent-event-types";

export type AgentRunMode = "mock" | "mock-error";

export type AgentRunRequest = {
  taskId: string;
  employeeId?: string;
  mode?: AgentRunMode;
};

export type AgentMetadata = {
  agentId: string;
  displayName: string;
  department: string;
  defaultSeat: string;
  allowedEvents: string[];
};

export type AgentRunContext = {
  runId: string;
  task: {
    id: string;
    title: string;
    description: string | null;
    department: string;
    status: string;
    currentStep: string | null;
    nextAction: string | null;
    assignedEmployeeId: string | null;
  };
  employee: {
    id: string;
    displayName: string;
    department: string;
  };
  agent: AgentMetadata;
};

export type MockAgentRunPlan = {
  summary: string;
  outputTitle: string;
  finalStatus: string;
  requiresApproval: boolean;
  approvalType?: string;
  approvalRisk?: string;
  approvalReason?: string;
};

export type AgentRunResult = {
  ok: true;
  runId: string;
  taskId: string;
  employeeId: string;
  status: "succeeded";
  mode: AgentRunMode;
  events: AgentEventProcessResult[];
  approvalId?: string;
  resultSummary: string;
};
