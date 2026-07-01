import { getHermesConfig } from "@/lib/agents/hermes-client";
import type { ContentPlannerHermesInput, HermesContentPlannerPayload, NormalizedHermesRunResult } from "./hermes-types";

function baseUrl(url: string) {
  return url.replace(/\/$/, "");
}

function getHermesBridgeConfig() {
  return {
    baseUrl: process.env.HERMES_BRIDGE_BASE_URL?.trim() || "http://hermes-bridge:8787",
    apiKey: process.env.BRIDGE_API_KEY?.trim() || process.env.HERMES_BRIDGE_API_KEY?.trim() || "",
    timeoutMs: Number(process.env.HERMES_BRIDGE_TIMEOUT_MS ?? process.env.HERMES_TIMEOUT_MS ?? "45000"),
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function pickRecord(raw: unknown) {
  const record = asRecord(raw);
  if (!record) return null;
  const result = asRecord(record.result);
  if (result) return result;
  const output = asRecord(record.output);
  if (output) return output;
  const data = asRecord(record.data);
  if (data) return data;
  return record;
}

function pickString(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return undefined;
}

function pickOutline(record: Record<string, unknown>) {
  const outline = record.outline ?? record.sections ?? record.headings;
  if (!Array.isArray(outline)) return undefined;
  const values = outline
    .map((item) => typeof item === "string" ? item : asRecord(item)?.title)
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0);
  return values.length > 0 ? values : undefined;
}

function extractHermesJobId(raw: unknown) {
  const record = asRecord(raw);
  if (!record) return undefined;
  for (const key of ["hermesJobId", "jobId", "id", "runId"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return undefined;
}

function extractErrorMessage(raw: unknown) {
  const record = asRecord(raw);
  if (!record) return undefined;
  const message = record.message ?? record.error ?? record.errorMessage;
  return typeof message === "string" ? message : undefined;
}

async function readResponseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { text };
  }
}

export function buildContentPlannerHermesPayload(input: ContentPlannerHermesInput): HermesContentPlannerPayload {
  return {
    agentId: "content-planner",
    role: "content_planner",
    taskType: "content_planning",
    input: {
      topic: input.topic,
      title: input.title,
      channel: input.channel,
      language: input.language ?? "ko",
    },
    context: {
      company: "BG Company",
      workflow: "content_pipeline",
      runnerMode: "hermes",
    },
  };
}

export function normalizeHermesRunResponse(raw: unknown, agentId = "content-planner"): NormalizedHermesRunResult {
  const record = pickRecord(raw);
  if (!record) {
    return {
      ok: false,
      provider: "hermes",
      agentId,
      raw,
      errorCode: "HERMES_INVALID_RESPONSE",
      errorMessage: "Hermes response did not contain an object result.",
    };
  }

  return {
    ok: true,
    provider: typeof record.provider === "string" && record.provider === "hermes-bridge" ? "hermes-bridge" : "hermes",
    agentId,
    title: pickString(record, ["title", "outputTitle", "headline"]),
    summary: pickString(record, ["summary", "outputSummary", "description"]),
    content: pickString(record, ["content", "body", "draft", "article"]),
    draftDirection: pickString(record, ["draftDirection", "direction", "strategy"]),
    outline: pickOutline(record),
    hermesJobId: extractHermesJobId(raw),
    durationMs: typeof record.durationMs === "number" ? record.durationMs : undefined,
    raw,
  };
}

export function hermesRunConfigStatus() {
  const bridge = getHermesBridgeConfig();
  const legacy = getHermesConfig();
  return {
    configured: Boolean(bridge.baseUrl && bridge.apiKey),
    bridgeBaseUrl: Boolean(bridge.baseUrl),
    bridgeApiKey: Boolean(bridge.apiKey),
    timeoutMs: Number.isFinite(bridge.timeoutMs) ? bridge.timeoutMs : 45000,
    legacy: {
      baseUrl: Boolean(legacy.baseUrl),
      apiKey: Boolean(legacy.apiKey),
      runPath: legacy.runPath,
    },
  };
}

export async function runContentPlannerHermes(input: ContentPlannerHermesInput): Promise<{
  payload: HermesContentPlannerPayload;
  result: NormalizedHermesRunResult;
}> {
  const config = getHermesBridgeConfig();
  const payload = buildContentPlannerHermesPayload(input);
  if (!config.baseUrl || !config.apiKey) {
    return {
      payload,
      result: {
        ok: false,
        provider: "hermes-bridge",
        agentId: "content-planner",
        errorCode: "HERMES_BRIDGE_NOT_CONFIGURED",
        errorMessage: "HERMES_BRIDGE_BASE_URL and BRIDGE_API_KEY are required for runnerMode=hermes.",
      },
    };
  }

  const timeoutMs = Number.isFinite(config.timeoutMs) ? config.timeoutMs : 45000;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${baseUrl(config.baseUrl)}/run`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "x-bridge-api-key": config.apiKey,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const raw = await readResponseBody(response);
    if (!response.ok) {
      const record = asRecord(raw);
      return {
        payload,
        result: {
          ok: false,
          provider: "hermes-bridge",
          agentId: "content-planner",
          raw,
          errorCode: typeof record?.errorCode === "string" ? record.errorCode : response.status === 401 ? "HERMES_BRIDGE_UNAUTHORIZED" : "HERMES_BRIDGE_HTTP_ERROR",
          errorMessage: extractErrorMessage(raw) ?? `Hermes bridge request failed with HTTP ${response.status}.`,
        },
      };
    }
    const result = normalizeHermesRunResponse(raw, "content-planner");
    return { payload, result: { ...result, provider: "hermes-bridge" } };
  } catch (error: unknown) {
    const isTimeout = error instanceof Error && error.name === "AbortError";
    return {
      payload,
      result: {
        ok: false,
        provider: "hermes-bridge",
        agentId: "content-planner",
        errorCode: isTimeout ? "HERMES_BRIDGE_TIMEOUT" : "HERMES_BRIDGE_NETWORK_ERROR",
        errorMessage: isTimeout ? `Hermes bridge request timed out after ${timeoutMs}ms.` : error instanceof Error ? error.message : "Unknown Hermes bridge request error.",
      },
    };
  } finally {
    clearTimeout(timeout);
  }
}
