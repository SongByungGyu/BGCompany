import type { AgentRunner } from "./agent-context-types";
import { HermesAgentRunner } from "./hermes-agent-runner";
import { MockAgentRunner } from "./mock-agent-runner";

export type AgentRunnerMode = "mock" | "hermes";

export function resolveAgentRunnerMode(requestedMode?: string): AgentRunnerMode {
  if (requestedMode === "hermes") return "hermes";
  if (requestedMode === "mock") return "mock";
  const envMode = process.env.AGENT_RUNNER_MODE;
  return envMode === "hermes" ? "hermes" : "mock";
}

export function getAgentRunner(mode: AgentRunnerMode): AgentRunner {
  if (mode === "hermes") return new HermesAgentRunner();
  return new MockAgentRunner();
}
