import { authorizePortfolioApi, noStoreJson } from "@/lib/portfolio/portfolio-api";
import { listPortfolioDailySnapshots } from "@/lib/portfolio/portfolio-daily-assistant-service";
import { getPortfolioDailyAssistantConfig } from "@/lib/portfolio/portfolio-daily-assistant-config";

export async function GET(request: Request) {
  const denied = await authorizePortfolioApi(request);
  if (denied) return denied;
  if (!getPortfolioDailyAssistantConfig().snapshotEnabled) {
    return noStoreJson({ enabled: false, message: "일일 Snapshot은 사용자 승인 전까지 비활성화되어 있습니다.", snapshots: [] });
  }
  const url = new URL(request.url);
  const rows = await listPortfolioDailySnapshots(url.searchParams.get("accountId"), Number(url.searchParams.get("take") ?? 90));
  return noStoreJson({
    snapshots: rows.map((row) => ({
      ...row,
      marketDate: row.marketDate.toISOString().slice(0, 10),
      capturedAt: row.capturedAt.toISOString(),
      totalMarketValue: row.totalMarketValue.toString(),
      totalCostBasis: row.totalCostBasis.toString(),
      totalUnrealizedProfitLoss: row.totalUnrealizedProfitLoss.toString(),
      totalReturnPercent: row.totalReturnPercent.toString(),
    })),
  });
}
