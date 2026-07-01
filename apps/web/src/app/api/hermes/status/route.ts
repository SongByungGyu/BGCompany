import { NextResponse } from "next/server";
import { requireAdminApiSession } from "@/lib/auth/admin-auth";
import { checkHermesBridgeHealth, checkHermesHealth, getHermesBridgeConfig, getHermesConfig } from "@/lib/agents/hermes-client";

function resolveRunnerMode() {
  const mode = process.env.AGENT_RUNNER_MODE;
  if (mode === "hermes" || mode === "hermes-dry-run" || mode === "mock") return mode;
  return "mock";
}

export async function GET(request: Request) {
  const auth = await requireAdminApiSession(request);
  if (!auth.ok) return auth.response;

  const config = getHermesConfig();
  const bridgeConfig = getHermesBridgeConfig();
  const runnerMode = resolveRunnerMode();
  const configured = {
    baseUrl: Boolean(config.baseUrl),
    apiKey: Boolean(config.apiKey),
    timeoutMs: Number.isFinite(config.timeoutMs) ? config.timeoutMs : 30000,
    healthPath: config.healthPath,
    runPath: config.runPath,
    bridgeBaseUrl: Boolean(bridgeConfig.baseUrl),
    bridgeApiKey: Boolean(bridgeConfig.apiKey),
    bridgeTimeoutMs: Number.isFinite(bridgeConfig.timeoutMs) ? bridgeConfig.timeoutMs : 45000,
  };

  const bridgeHealth = configured.bridgeBaseUrl ? await checkHermesBridgeHealth() : null;
  const legacyHealth = configured.baseUrl ? await checkHermesHealth() : null;
  const available = Boolean(bridgeHealth?.ok || legacyHealth?.ok);

  return NextResponse.json({
    ok: true,
    runnerMode,
    configured,
    available,
    bridge: bridgeHealth ? {
      ok: bridgeHealth.ok,
      status: bridgeHealth.status,
      message: bridgeHealth.message,
      raw: bridgeHealth.raw,
    } : null,
    health: legacyHealth ? {
      ok: legacyHealth.ok,
      status: legacyHealth.status,
      message: legacyHealth.message,
      raw: legacyHealth.raw,
    } : null,
    message: available ? "Hermes bridge or Hermes API is available." : bridgeHealth?.message ?? legacyHealth?.message ?? "Hermes is not configured. Mock runner is active.",
  });
}
