import type { AgentRunner } from "./agent-context-types";

export class HermesAgentRunner implements AgentRunner {
  async run(): Promise<never> {
    throw new Error("Hermes agent runner is not implemented yet");
  }
}
