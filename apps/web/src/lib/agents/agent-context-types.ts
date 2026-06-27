import type { MockAgentRunPlan } from "./agent-runner-types";

export type AgentMetadata = {
  agentId: string;
  displayName: string;
  department: string;
  defaultSeat: string;
  allowedEvents: string[];
};

export type AgentRoleDocument = AgentMetadata & {
  manager?: string;
  forbiddenActions: string[];
  roleDocument: string;
  roleSummary: string;
  approvalConditions: string[];
  outputFormat: string;
  reportingRules: string;
};

export type AgentRunContext = {
  runId: string;
  task: {
    id: string;
    title: string;
    description?: string | null;
    department: string;
    status: string;
    assignedEmployeeId?: string | null;
    currentStep?: string | null;
    recentOutput?: string | null;
    nextAction?: string | null;
  };
  employee: {
    id: string;
    displayName: string;
    department: string;
    status: string;
  };
  agent: AgentRoleDocument;
  constraints: {
    requiresApproval: boolean;
    forbiddenActions: string[];
    readOnlyFinance: boolean;
    readOnlyStocks: boolean;
    safetyRules: string[];
  };
  eventContract: {
    endpoint: string;
    supportedEvents: string[];
  };
  outputFormat: string;
  callback: {
    agentEventsEndpoint: string;
  };
  metadata: Record<string, unknown>;
};

export type AgentRunContextSummary = {
  runId: string;
  taskId: string;
  taskTitle: string;
  employeeId: string;
  agentId: string;
  displayName: string;
  department: string;
  allowedEvents: string[];
  forbiddenActions: string[];
  requiresApproval: boolean;
  readOnlyFinance: boolean;
  readOnlyStocks: boolean;
  safetyRules: string[];
  outputFormat: string;
  reportingRules: string;
  eventEndpoint: string;
};

export interface AgentRunner {
  run(context: AgentRunContext): Promise<MockAgentRunPlan>;
}
