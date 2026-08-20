import type { FredResult } from "./fred-macro-provider";
import type { KisResult } from "./kis-market-data-provider";
import type { MarketSnapshot, MarketSnapshotFreshness, StockReferenceBriefingTemplate } from "./reference-types";

export const KIS_OVERSEAS_DEGRADED_MODE = "kis_overseas_unavailable" as const;
export const KIS_OVERSEAS_DEGRADED_PROVIDER = "kis-overseas" as const;
export const KIS_OVERSEAS_DEGRADED_DISCLOSURE = "※ 확인되지 않은 해외지수·환율 수치와 관련 그래프는 제외하고, 검증된 국내 지수·수급·미국 금리 자료만 사용했습니다.";

const OPTIONAL_KOREA_PREVIEW_ITEMS = new Set(["S&P 500", "NASDAQ", "Dow Jones", "USD/KRW"]);

function hasRequiredKoreaPreviewCore(kis: KisResult, fred: FredResult) {
  return Boolean(
    kis.korea?.kospi
      && kis.korea.kosdaq
      && kis.korea.investorFlows?.length
      && kis.korea.strongSectors?.length
      && kis.korea.weakSectors?.length
      && fred.macro?.us2Year
      && fred.macro.us10Year
      && fred.upcoming?.length,
  );
}

export function isKisOverseasDegradedEnabled() {
  return process.env.STOCK_MARKET_DATA_ALLOW_KIS_OVERSEAS_DEGRADED !== "false";
}

export function canUseKisOverseasDegradedMode(
  contentType: StockReferenceBriefingTemplate,
  kis: KisResult,
  fred: FredResult,
  freshness: MarketSnapshotFreshness,
) {
  if (!isKisOverseasDegradedEnabled() || contentType !== "KOREA_DAILY_PREVIEW") return false;
  if (kis.status !== "needs_data" || fred.status !== "ready") return false;
  if (!hasRequiredKoreaPreviewCore(kis, fred)) return false;
  if (freshness.status !== "fresh" || freshness.staleItems.length > 0) return false;
  if (!kis.missingItems.length || kis.missingItems.some((item) => !OPTIONAL_KOREA_PREVIEW_ITEMS.has(item))) return false;
  return true;
}

export function isAllowedKisOverseasDegradedSnapshot(snapshot?: MarketSnapshot) {
  return Boolean(
    snapshot
      && snapshot.provider === "kis-fred"
      && snapshot.status === "ready"
      && snapshot.dataQuality === "partial"
      && snapshot.degradedMode === KIS_OVERSEAS_DEGRADED_MODE
      && snapshot.degradedProviders?.includes(KIS_OVERSEAS_DEGRADED_PROVIDER)
      && snapshot.freshness?.status === "fresh"
      && snapshot.freshness.staleItems.length === 0
      && snapshot.disclosures?.includes(KIS_OVERSEAS_DEGRADED_DISCLOSURE),
  );
}

export function ensureKisOverseasDegradedDisclosure(body: string, snapshot?: MarketSnapshot) {
  if (!isAllowedKisOverseasDegradedSnapshot(snapshot) || body.includes(KIS_OVERSEAS_DEGRADED_DISCLOSURE)) return body;
  const trimmed = body.trimEnd();
  return `${trimmed}${trimmed ? "\n\n" : ""}${KIS_OVERSEAS_DEGRADED_DISCLOSURE}`;
}
