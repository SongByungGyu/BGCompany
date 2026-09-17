import {
  buildContentPlannerHermesPayload,
  buildContentWriterHermesPayload,
  buildMarketingReviewHermesPayload,
  buildQaAuditHermesPayload,
  normalizeContentWriterHermesResponse,
  normalizeHermesRunResponse,
  normalizeMarketingReviewHermesResponse,
  normalizeQaAuditHermesResponse,
} from "@/lib/hermes/hermes-client";
import type {
  ContentPlannerHermesInput,
  ContentWriterHermesInput,
  ContentWriterResult,
  HermesContentPlannerPayload,
  HermesContentWriterPayload,
  HermesMarketingReviewPayload,
  HermesQaAuditPayload,
  MarketingReviewHermesInput,
  MarketingReviewResult,
  NormalizedHermesRunResult,
  QaAuditHermesInput,
  QaAuditResult,
} from "@/lib/hermes/hermes-types";

type CodexAgentId = "content-planner" | "marketing-manager" | "content-writer" | "qa-auditor";
type CodexPayload = HermesContentPlannerPayload | HermesMarketingReviewPayload | HermesContentWriterPayload | HermesQaAuditPayload;

function positiveNumber(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function config(agentId: CodexAgentId) {
  const processTimeouts: Record<CodexAgentId, number> = {
    "content-planner": positiveNumber(process.env.CODEX_CONTENT_PLANNER_TIMEOUT_MS, 300_000),
    "marketing-manager": positiveNumber(process.env.CODEX_CONTENT_MARKETING_TIMEOUT_MS, 300_000),
    "content-writer": positiveNumber(process.env.CODEX_CONTENT_WRITER_TIMEOUT_MS, 600_000),
    "qa-auditor": positiveNumber(process.env.CODEX_CONTENT_QA_TIMEOUT_MS, 420_000),
  };
  const processTimeoutMs = processTimeouts[agentId];
  return {
    baseUrl: (process.env.CODEX_CONTENT_BRIDGE_BASE_URL?.trim() || "http://host.docker.internal:43926").replace(/\/$/, ""),
    apiKey: process.env.CODEX_QA_AGENT_KEY?.trim() || "",
    processTimeoutMs,
    timeoutMs: processTimeoutMs + positiveNumber(process.env.CODEX_CONTENT_CLIENT_TIMEOUT_BUFFER_MS, 30_000),
  };
}

function codexPayload(payload: CodexPayload): CodexPayload {
  return {
    ...payload,
    context: { ...payload.context, runnerMode: "codex" },
  } as unknown as CodexPayload;
}

async function responseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { text };
  }
}

function errorMessage(raw: unknown) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const record = raw as Record<string, unknown>;
  const value = record.errorMessage ?? record.message ?? record.error;
  return typeof value === "string" ? value : undefined;
}

async function postCodex<T extends { provider: string }>(
  rawPayload: CodexPayload,
  agentId: CodexAgentId,
  normalize: (raw: unknown) => T,
): Promise<{ payload: CodexPayload; result: T }> {
  const payload = codexPayload(rawPayload);
  const bridge = config(agentId);
  if (!bridge.apiKey) {
    return {
      payload,
      result: {
        ok: false,
        provider: "codex",
        agentId,
        errorCode: "CODEX_CONTENT_BRIDGE_NOT_CONFIGURED",
        errorMessage: "CODEX_QA_AGENT_KEY is required for runnerMode=codex.",
      } as unknown as T,
    };
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), bridge.timeoutMs);
  try {
    const response = await fetch(`${bridge.baseUrl}/run`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "x-codex-content-key": bridge.apiKey,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const raw = await responseBody(response);
    if (!response.ok) {
      return {
        payload,
        result: {
          ok: false,
          provider: "codex",
          agentId,
          raw,
          errorCode: response.status === 401 ? "CODEX_CONTENT_BRIDGE_UNAUTHORIZED" : "CODEX_CONTENT_BRIDGE_HTTP_ERROR",
          errorMessage: errorMessage(raw) ?? `Codex content bridge request failed with HTTP ${response.status}.`,
        } as unknown as T,
      };
    }
    return { payload, result: { ...normalize(raw), provider: "codex" } as T };
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "AbortError";
    return {
      payload,
      result: {
        ok: false,
        provider: "codex",
        agentId,
        errorCode: timedOut ? "CODEX_CONTENT_BRIDGE_TIMEOUT" : "CODEX_CONTENT_BRIDGE_NETWORK_ERROR",
        errorMessage: timedOut
          ? `Codex content bridge deadline exceeded after ${bridge.timeoutMs}ms.`
          : error instanceof Error ? error.message : "Unknown Codex content bridge error.",
      } as unknown as T,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function runContentPlannerCodex(input: ContentPlannerHermesInput): Promise<{
  payload: CodexPayload;
  result: NormalizedHermesRunResult;
}> {
  return postCodex(buildContentPlannerHermesPayload(input), "content-planner", (raw) => normalizeHermesRunResponse(raw, "content-planner"));
}

export async function runMarketingReviewCodex(input: MarketingReviewHermesInput): Promise<{
  payload: CodexPayload;
  result: MarketingReviewResult;
}> {
  return postCodex(buildMarketingReviewHermesPayload(input), "marketing-manager", normalizeMarketingReviewHermesResponse);
}

export async function runContentWriterCodex(input: ContentWriterHermesInput): Promise<{
  payload: CodexPayload;
  result: ContentWriterResult;
}> {
  return postCodex(buildContentWriterHermesPayload(input), "content-writer", normalizeContentWriterHermesResponse);
}

export async function runQaAuditCodex(input: QaAuditHermesInput): Promise<{
  payload: CodexPayload;
  result: QaAuditResult;
}> {
  return postCodex(buildQaAuditHermesPayload(input), "qa-auditor", normalizeQaAuditHermesResponse);
}
