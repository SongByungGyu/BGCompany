export type ContentPlannerHermesInput = {
  topic: string;
  title: string;
  channel: string;
  language?: "ko" | "en";
};

export type HermesContentPlannerPayload = {
  agentId: "content-planner";
  role: "content_planner";
  taskType: "content_planning";
  input: {
    topic: string;
    title: string;
    channel: string;
    language: "ko" | "en";
  };
  context: {
    company: "BG Company";
    workflow: "content_pipeline";
    runnerMode: "hermes";
  };
};

export type NormalizedHermesRunResult = {
  ok: boolean;
  provider: "hermes" | "hermes-bridge";
  agentId: string;
  title?: string;
  summary?: string;
  content?: string;
  draftDirection?: string;
  outline?: string[];
  raw?: unknown;
  hermesJobId?: string;
  durationMs?: number;
  errorCode?: string;
  errorMessage?: string;
};
