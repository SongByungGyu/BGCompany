import type { AgentEventProcessResult } from "@/lib/events/agent-event-types";

export type AgentRunMode = "mock" | "mock-error" | "hermes";

export type AgentRunRequest = {
  taskId: string;
  employeeId?: string;
  mode?: AgentRunMode;
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
