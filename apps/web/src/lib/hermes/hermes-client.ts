import { getHermesConfig } from "@/lib/agents/hermes-client";
import type { ContentPlannerHermesInput, HermesContentPlannerPayload, NormalizedHermesRunResult } from "./hermes-types";

function normalizePath(path: string) {
  return path.startsWith("/") ? path : `/${path}`;
}

function baseUrl(url: string) {
  return url.replace(/\/$/, "");
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
    provider: "hermes",
    agentId,
    title: pickString(record, ["title", "outputTitle", "headline"]),
    summary: pickString(record, ["summary", "outputSummary", "description"]),
    content: pickString(record, ["content", "body", "draft", "article"]),
    draftDirection: pickString(record, ["draftDirection", "direction", "strategy"]),
    outline: pickOutline(record),
    hermesJobId: extractHermesJobId(raw),
    raw,
  };
}

export function hermesRunConfigStatus() {
  const config = getHermesConfig();
  return {
    configured: Boolean(config.baseUrl && config.apiKey),
    baseUrl: Boolean(config.baseUrl),
    apiKey: Boolean(config.apiKey),
    runPath: config.runPath,
    timeoutMs: Number.isFinite(config.timeoutMs) ? config.timeoutMs : 30000,
  };
}

export async function runContentPlannerHermes(input: ContentPlannerHermesInput): Promise<{
  payload: HermesContentPlannerPayload;
  result: NormalizedHermesRunResult;
}> {
  const config = getHermesConfig();
  const payload = buildContentPlannerHermesPayload(input);
  if (!config.baseUrl || !config.apiKey) {
    return {
      payload,
      result: {
        ok: false,
        provider: "hermes",
        agentId: "content-planner",
        errorCode: "HERMES_NOT_CONFIGURED",
        errorMessage: "HERMES_BASE_URL and HERMES_API_KEY are required for runnerMode=hermes.",
      },
    };
  }

  const timeoutMs = Number.isFinite(config.timeoutMs) ? config.timeoutMs : 30000;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${baseUrl(config.baseUrl)}${normalizePath(config.runPath)}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const raw = await readResponseBody(response);
    if (!response.ok) {
      return {
        payload,
        result: {
          ok: false,
          provider: "hermes",
          agentId: "content-planner",
          raw,
          errorCode: "HERMES_HTTP_ERROR",
          errorMessage: extractErrorMessage(raw) ?? `Hermes request failed with HTTP ${response.status}.`,
        },
      };
    }
    return { payload, result: normalizeHermesRunResponse(raw, "content-planner") };
  } catch (error: unknown) {
    const isTimeout = error instanceof Error && error.name === "AbortError";
    return {
      payload,
      result: {
        ok: false,
        provider: "hermes",
        agentId: "content-planner",
        errorCode: isTimeout ? "HERMES_TIMEOUT" : "HERMES_REQUEST_ERROR",
        errorMessage: isTimeout ? `Hermes request timed out after ${timeoutMs}ms.` : error instanceof Error ? error.message : "Unknown Hermes request error.",
      },
    };
  } finally {
    clearTimeout(timeout);
  }
}
