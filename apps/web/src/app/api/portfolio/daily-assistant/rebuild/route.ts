import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { authorizePortfolioApi } from "@/lib/portfolio/portfolio-api";
import { getPortfolioDailyAssistantConfig } from "@/lib/portfolio/portfolio-daily-assistant-config";
import {
  assertDailyAssistantRebuildRateLimit,
  capturePortfolioDailySnapshot,
  getPortfolioDailyAssistant,
} from "@/lib/portfolio/portfolio-daily-assistant-service";
import { getPortfolioDashboard } from "@/lib/portfolio/portfolio-service";

function object(value: Prisma.JsonValue) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, Prisma.JsonValue>
    : {};
}

export async function POST(request: Request) {
  const denied = await authorizePortfolioApi(request, true);
  if (denied) return denied;
  const config = getPortfolioDailyAssistantConfig();
  if (!config.snapshotEnabled || !config.assistantEnabled) {
    return NextResponse.json({ error: "일일 Snapshot과 비서 기능이 비활성화되어 있습니다." }, { status: 503 });
  }
  try {
    const clientKey = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "admin";
    assertDailyAssistantRebuildRateLimit(clientKey);
    const body = await request.json().catch(() => ({})) as { accountId?: string };
    const latestRun = await prisma.eventLog.findFirst({
      where: { type: "PortfolioDailyAccountSync" },
      orderBy: { timestamp: "desc" },
      select: { id: true, payload: true },
    });
    const payload = latestRun ? object(latestRun.payload) : {};
    if (!latestRun || payload.status !== "succeeded") {
      return NextResponse.json({ error: "재생성에 사용할 정상 Daily Sync Run이 없습니다." }, { status: 409 });
    }
    const accountId = body.accountId || (typeof payload.accountId === "string" ? payload.accountId : "");
    const dateKey = typeof payload.snapshotDate === "string"
      ? payload.snapshotDate
      : typeof payload.dateKey === "string" ? payload.dateKey : "";
    if (!accountId || !dateKey) return NextResponse.json({ error: "정상 Sync Run의 계좌 또는 기준일 정보가 없습니다." }, { status: 409 });
    const dashboard = await getPortfolioDashboard(accountId);
    const captured = await capturePortfolioDailySnapshot({
      dashboard,
      sourceSyncRunId: latestRun.id,
      marketDate: dateKey,
    });
    return NextResponse.json({ ok: true, captured, assistant: await getPortfolioDailyAssistant(accountId) });
  } catch (error) {
    const limited = error instanceof Error && error.message === "DAILY_ASSISTANT_REBUILD_RATE_LIMITED";
    return NextResponse.json({ error: limited ? "일일 비서 재계산은 1분에 2회까지 가능합니다." : "일일 비서 재계산에 실패했습니다." }, { status: limited ? 429 : 500 });
  }
}
