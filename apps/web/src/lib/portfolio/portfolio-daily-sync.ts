import "server-only";
import { prisma } from "@/lib/db";
import { portfolioConfig } from "./portfolio-config";
import { refreshPortfolio, syncTossPortfolioAccount } from "./portfolio-service";
import type { PortfolioDailySyncExecution } from "./portfolio-sync-scheduler";
import { capturePortfolioDailySnapshot } from "./portfolio-daily-assistant-service";

export async function executeDailyPortfolioSync(input: { snapshotDate: string; sourceSyncRunId: string }): Promise<PortfolioDailySyncExecution> {
  const config = portfolioConfig();
  if (!config.accountSyncEnabled || config.accountSyncProvider !== "toss") {
    throw new Error("토스증권 읽기 전용 계좌 동기화가 설정되지 않았습니다.");
  }
  if (config.priceProvider !== "kis") {
    throw new Error("자동 동기화의 가격 공급자는 KIS로 설정해야 합니다.");
  }

  const synced = await syncTossPortfolioAccount({ refresh: false });
  const dashboard = await refreshPortfolio(synced.result.accountId, {
    forcePriceRefresh: true,
    snapshotDate: input.snapshotDate,
    triggerSource: "portfolio-daily-scheduler",
  });
  const daily = await capturePortfolioDailySnapshot({
    dashboard,
    sourceSyncRunId: input.sourceSyncRunId,
    marketDate: input.snapshotDate,
  });
  const latestPrice = await prisma.portfolioPriceSnapshot.findFirst({
    where: { provider: { contains: "KIS" } },
    orderBy: { collectedAt: "desc" },
    select: { collectedAt: true },
  });
  return {
    accountId: synced.result.accountId,
    accountSyncedAt: synced.result.syncedAt,
    priceRefreshedAt: latestPrice?.collectedAt.toISOString() ?? null,
    snapshotDate: input.snapshotDate,
    created: synced.result.created,
    updated: synced.result.updated,
    deactivated: synced.result.deactivated,
    totalCount: synced.result.totalCount,
    dailySnapshotId: daily.enabled ? daily.snapshotId : undefined,
  };
}
