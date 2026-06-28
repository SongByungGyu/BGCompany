import { NextResponse } from "next/server";
import { requireAdminApiSession } from "@/lib/auth/admin-auth";
import { checkHermesHealth, getHermesConfig } from "@/lib/agents/hermes-client";

function resolveRunnerMode() {
  const mode = process.env.AGENT_RUNNER_MODE;
  if (mode === "hermes" || mode === "hermes-dry-run" || mode === "mock") return mode;
  return "mock";
}

export async function GET(request: Request) {
  const auth = await requireAdminApiSession(request);
  if (!auth.ok) return auth.response;

  const config = getHermesConfig();
  const runnerMode = resolveRunnerMode();
  const configured = {
    baseUrl: Boolean(config.baseUrl),
    apiKey: Boolean(config.apiKey),
    timeoutMs: Number.isFinite(config.timeoutMs) ? config.timeoutMs : 30000,
    healthPath: config.healthPath,
  };

  if (!configured.baseUrl) {
    return NextResponse.json({
      ok: true,
      runnerMode,
      configured,
      available: false,
      message: "Hermes is not configured. Mock runner is active.",
    });
  }

  const health = await checkHermesHealth();
  return NextResponse.json({
    ok: true,
    runnerMode,
    configured,
    available: health.ok,
    health: {
      ok: health.ok,
      status: health.status,
      message: health.message,
      raw: health.raw,
    },
    message: health.ok ? "Hermes is configured and health check passed." : health.message ?? "Hermes health check failed.",
  });
}
