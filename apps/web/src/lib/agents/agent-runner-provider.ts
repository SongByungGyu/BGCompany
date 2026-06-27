import type { AgentRunner } from "./agent-context-types";
import { HermesAgentRunner, HermesDryRunAgentRunner } from "./hermes-agent-runner";
import { MockAgentRunner } from "./mock-agent-runner";

export type AgentRunnerMode = "mock" | "hermes" | "hermes-dry-run";

export function resolveAgentRunnerMode(requestedMode?: string): AgentRunnerMode {
  if (requestedMode === "hermes") return "hermes";
  if (requestedMode === "hermes-dry-run") return "hermes-dry-run";
  if (requestedMode === "mock") return "mock";
  const envMode = process.env.AGENT_RUNNER_MODE;
  if (envMode === "hermes") return "hermes";
  if (envMode === "hermes-dry-run") return "hermes-dry-run";
  return "mock";
}

export function getAgentRunner(mode: AgentRunnerMode): AgentRunner {
  if (mode === "hermes") return new HermesAgentRunner();
  if (mode === "hermes-dry-run") return new HermesDryRunAgentRunner();
  return new MockAgentRunner();
}
