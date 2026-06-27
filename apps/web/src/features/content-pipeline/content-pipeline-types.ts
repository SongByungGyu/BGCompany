export type ContentChannel = "blog" | "instagram" | "youtube" | "newsletter";
export type ContentPipelineStatus =
  | "draft_requested"
  | "planning"
  | "marketing_review"
  | "qa_review"
  | "director_approval"
  | "approved"
  | "rejected"
  | "published_ready"
  | "completed";

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
  createdAt: string;
  updatedAt: string;
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
