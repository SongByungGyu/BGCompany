import type { AgentRunContext, AgentRunner } from "./agent-context-types";
import type { MockAgentRunPlan } from "./agent-runner-types";
import { buildHermesRunPayload, sendHermesRunRequest, summarizeHermesPayload } from "./hermes-client";

export class HermesAgentRunner implements AgentRunner {
  async run(context: AgentRunContext): Promise<MockAgentRunPlan> {
    const response = await sendHermesRunRequest(context);
    return {
      summary: response.message ?? "Hermes job submitted",
      outputTitle: "Hermes job submitted",
      finalStatus: "진행 중",
      requiresApproval: false,
      runnerStatus: "submitted",
      hermesJobId: response.hermesJobId,
      hermesStatus: response.status ?? "submitted",
      hermesPayloadSummary: summarizeHermesPayload(buildHermesRunPayload(context)),
    };
  }
}

export class HermesDryRunAgentRunner implements AgentRunner {
  async run(context: AgentRunContext): Promise<MockAgentRunPlan> {
    const payload = buildHermesRunPayload(context);
    return {
      summary: "Hermes dry-run payload generated",
      outputTitle: "Hermes dry-run payload generated",
      finalStatus: "업무 중",
      requiresApproval: false,
      runnerStatus: "dry-run",
      hermesStatus: "dry-run",
      hermesPayloadSummary: summarizeHermesPayload(payload),
    };
  }
}
