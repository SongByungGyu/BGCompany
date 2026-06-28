import type { TimelineRecord } from "@/features/timelines/api";

export type ContentChannel = "blog" | "instagram" | "youtube" | "newsletter";
export type ContentPipelineStatus =
  | "draft_requested"
  | "planning"
  | "marketing_review"
  | "qa_review"
  | "director_approval"
  | "approved"
  | "rejected"
  | "revision_requested"
  | "published_ready"
  | "completed";

export type ContentPlannerResult = {
  ok: boolean;
  provider: string;
  agentId: string;
  title?: string;
  summary?: string;
  content?: string;
  draftDirection?: string;
  outline?: string[];
  errorCode?: string;
  errorMessage?: string;
};

export type ContentPipelineRun = {
  id: string;
  title: string;
  topic: string;
  channel: ContentChannel;
  status: ContentPipelineStatus;
  currentStep: string;
  taskIds: string[];
  approvalId?: string;
  outputTitle?: string;
  outputSummary?: string;
  runnerMode?: "mock" | "hermes-dry-run" | "hermes";
  plannerResult?: ContentPlannerResult;
  hermesRequestPayload?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type ContentPipelineTask = {
  id: string;
  title: string;
  status: string;
  progress: number;
  assignedEmployeeId: string | null;
  currentStep: string | null;
  recentOutput: string | null;
};

export type ContentPipelineApproval = {
  id: string;
  title: string;
  status: string;
  requestedByEmployeeId: string;
  taskId: string | null;
  reason: string;
  decision: string | null;
  decisionReason: string | null;
};

export type ContentPipelineAgentRun = {
  id: string;
  taskId: string | null;
  employeeId: string;
  mode: string;
  status: string;
  resultSummary: string | null;
  errorMessage: string | null;
  hermesJobId: string | null;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type ContentPipelineDetail = {
  pipeline: ContentPipelineRun;
  tasks: ContentPipelineTask[];
  approval: ContentPipelineApproval | null;
  agentRuns: ContentPipelineAgentRun[];
  timeline: TimelineRecord[];
};

export type ContentPipelineRequest = {
  topic: string;
  channel: ContentChannel;
  title: string;
  runnerMode?: "mock" | "hermes-dry-run" | "hermes";
};

export type ContentPipelineResponse = {
  ok: true;
  pipeline: ContentPipelineRun;
};
