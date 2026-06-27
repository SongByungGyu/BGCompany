import type { AgentRunContext } from "./agent-context-types";

export type HermesRunPayload = {
  runId: string;
  task: {
    id: string;
    title: string;
    description?: string | null;
    department: string;
    currentStep?: string | null;
    nextAction?: string | null;
  };
  agent: {
    id: string;
    displayName: string;
    department: string;
    roleSummary: string;
    outputFormat: string;
    reportingRules: string;
  };
  constraints: AgentRunContext["constraints"];
  eventContract: AgentRunContext["eventContract"];
  callback: {
    method: "POST";
    endpoint: string;
  };
  metadata: {
    source: "bg-company";
    mode: "hermes";
    employeeId: string;
    allowedEvents: string[];
    approvalConditions: string[];
  };
};

export type HermesRunResponse = {
  ok: boolean;
  hermesJobId?: string;
  status?: string;
  message?: string;
  raw?: unknown;
};

export type HermesHealthResult = {
  ok: boolean;
  status?: number;
  message?: string;
  raw?: unknown;
};

export class HermesClientError extends Error {
  code: string;
  status?: number;

  constructor(code: string, message: string, status?: number) {
    super(message);
    this.name = "HermesClientError";
    this.code = code;
    this.status = status;
  }
}

export function getHermesConfig() {
  return {
    baseUrl: process.env.HERMES_BASE_URL?.trim() ?? "",
    apiKey: process.env.HERMES_API_KEY?.trim() ?? "",
    timeoutMs: Number(process.env.HERMES_TIMEOUT_MS ?? "30000"),
    healthPath: process.env.HERMES_HEALTH_PATH?.trim() || "/health",
  };
}

export function buildHermesRunPayload(context: AgentRunContext): HermesRunPayload {
  return {
    runId: context.runId,
    task: {
      id: context.task.id,
      title: context.task.title,
      description: context.task.description,
      department: context.task.department,
      currentStep: context.task.currentStep,
      nextAction: context.task.nextAction,
    },
    agent: {
      id: context.agent.agentId,
      displayName: context.agent.displayName,
      department: context.agent.department,
      roleSummary: context.agent.roleSummary,
      outputFormat: context.outputFormat,
      reportingRules: context.agent.reportingRules,
    },
    constraints: context.constraints,
    eventContract: context.eventContract,
    callback: {
      method: "POST",
      endpoint: context.callback.agentEventsEndpoint,
    },
    metadata: {
      source: "bg-company",
      mode: "hermes",
      employeeId: context.employee.id,
      allowedEvents: context.agent.allowedEvents,
      approvalConditions: context.agent.approvalConditions,
    },
  };
}

export function summarizeHermesPayload(payload: HermesRunPayload) {
  return {
    runId: payload.runId,
    taskId: payload.task.id,
    taskTitle: payload.task.title,
    agentId: payload.agent.id,
    agentDisplayName: payload.agent.displayName,
    callbackEndpoint: payload.callback.endpoint,
    eventEndpoint: payload.eventContract.endpoint,
    allowedEventCount: payload.metadata.allowedEvents.length,
    forbiddenActions: payload.constraints.forbiddenActions,
    requiresApproval: payload.constraints.requiresApproval,
    readOnlyFinance: payload.constraints.readOnlyFinance,
    readOnlyStocks: payload.constraints.readOnlyStocks,
  };
}

function extractHermesJobId(raw: unknown): string | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const data = raw as Record<string, unknown>;
  for (const key of ["hermesJobId", "jobId", "id", "runId"]) {
    const value = data[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return undefined;
}

function extractStatus(raw: unknown): string | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const data = raw as Record<string, unknown>;
  const status = data.status;
  return typeof status === "string" ? status : undefined;
}

function extractMessage(raw: unknown): string | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const data = raw as Record<string, unknown>;
  const message = data.message ?? data.error;
  return typeof message === "string" ? message : undefined;
}

function normalizePath(path: string) {
  return path.startsWith("/") ? path : `/${path}`;
}

export async function checkHermesHealth(): Promise<HermesHealthResult> {
  const config = getHermesConfig();
  if (!config.baseUrl) {
    return {
      ok: false,
      message: "Hermes is not configured. Mock runner is active.",
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number.isFinite(config.timeoutMs) ? config.timeoutMs : 30000);

  try {
    const response = await fetch(`${config.baseUrl.replace(/\/$/, "")}${normalizePath(config.healthPath)}`, {
      method: "GET",
      headers: {
        ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
      },
      signal: controller.signal,
    });
    const raw = await response.json().catch(() => null);
    return {
      ok: response.ok,
      status: response.status,
      message: response.ok ? "Hermes health check passed." : extractMessage(raw) ?? `Hermes health check failed with status ${response.status}`,
      raw,
    };
  } catch (error: unknown) {
    if (error instanceof Error && error.name === "AbortError") {
      return { ok: false, message: "Hermes health check timed out." };
    }
    const message = error instanceof Error ? error.message : "Unknown Hermes health check error";
    return { ok: false, message };
  } finally {
    clearTimeout(timeout);
  }
}

export async function sendHermesRunRequest(context: AgentRunContext): Promise<HermesRunResponse> {
  const config = getHermesConfig();
  if (!config.baseUrl) {
    throw new HermesClientError("HERMES_NOT_CONFIGURED", "HERMES_BASE_URL is required when AGENT_RUNNER_MODE=hermes or mode=hermes.", 500);
  }

  const payload = buildHermesRunPayload(context);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number.isFinite(config.timeoutMs) ? config.timeoutMs : 30000);

  try {
    const response = await fetch(`${config.baseUrl.replace(/\/$/, "")}/agent-runs`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    const raw = await response.json().catch(() => null);
    if (!response.ok) {
      throw new HermesClientError(
        "HERMES_REQUEST_FAILED",
        extractMessage(raw) ?? `Hermes request failed with status ${response.status}`,
        response.status,
      );
    }

    return {
      ok: true,
      hermesJobId: extractHermesJobId(raw),
      status: extractStatus(raw) ?? "submitted",
      message: extractMessage(raw),
      raw,
    };
  } catch (error: unknown) {
    if (error instanceof HermesClientError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new HermesClientError("HERMES_TIMEOUT", "Hermes request timed out", 504);
    }
    const message = error instanceof Error ? error.message : "Unknown Hermes request error";
    throw new HermesClientError("HERMES_REQUEST_ERROR", message, 500);
  } finally {
    clearTimeout(timeout);
  }
}
