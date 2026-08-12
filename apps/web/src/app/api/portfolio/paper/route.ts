import { NextResponse } from "next/server";
import { authorizePortfolioApi, noStoreJson } from "@/lib/portfolio/portfolio-api";
import {
  getPaperTradingDashboard,
  initializePaperTradingAccount,
  initializePaperTradingTeamForCurrentAccount,
  setPaperTradingStatus,
} from "@/lib/portfolio/paper-trading-service";
import { getPaperTradingAutomationStatus } from "@/lib/portfolio/paper-trading-scheduler";
import type { PaperTradingSystemStatus } from "@/lib/portfolio/paper-trading-types";

export async function GET(request: Request) {
  const denied = await authorizePortfolioApi(request);
  if (denied) return denied;
  const [dashboard, automation] = await Promise.all([getPaperTradingDashboard(), getPaperTradingAutomationStatus()]);
  return noStoreJson(dashboard.enabled ? { ...dashboard, automation } : dashboard);
}

export async function POST(request: Request) {
  const denied = await authorizePortfolioApi(request, true);
  if (denied) return denied;
  try {
    const body = await request.json() as { action?: string };
    if (body.action === "initialize") return noStoreJson(await initializePaperTradingAccount());
    if (body.action === "initialize-team") return noStoreJson(await initializePaperTradingTeamForCurrentAccount());
    const statusByAction: Record<string, PaperTradingSystemStatus> = {
      resume: "ACTIVE",
      pause: "PAUSED",
      kill: "KILLED",
    };
    const status = body.action ? statusByAction[body.action] : undefined;
    if (!status) return NextResponse.json({ error: "지원하지 않는 모의투자 작업입니다." }, { status: 400 });
    return noStoreJson(await setPaperTradingStatus(status));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "모의투자 상태 변경에 실패했습니다." }, { status: 400 });
  }
}
