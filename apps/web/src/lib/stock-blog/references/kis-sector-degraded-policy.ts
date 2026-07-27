import type { FredResult } from "./fred-macro-provider";
import type { KisResult } from "./kis-market-data-provider";
import type { MarketSnapshot, MarketSnapshotFreshness } from "./reference-types";

export const KIS_SECTOR_DEGRADED_MODE = "kis_sector_unavailable" as const;
export const KIS_SECTOR_DEGRADED_PROVIDER = "kis-sector" as const;
export const KIS_SECTOR_DEGRADED_DISCLOSURE = "KIS 업종 등락 자료가 일시적으로 비어 있어 강세·약세 업종 항목은 제외하고, 검증된 지수·수급·환율·거시자료만 사용했습니다.";

function isSectorMissingItem(item: string) {
  return /업종/.test(item);
}

function hasRequiredKisCore(kis: KisResult) {
  return Boolean(
    kis.korea?.kospi
      && kis.korea.kosdaq
      && kis.korea.investorFlows?.length
      && kis.us?.sp500
      && kis.us.nasdaq
      && kis.us.dow
      && kis.us.fx,
  );
}

export function isKisSectorDegradedEnabled() {
  return process.env.STOCK_MARKET_DATA_ALLOW_KIS_SECTOR_DEGRADED !== "false";
}

export function canUseKisSectorDegradedMode(
  kis: KisResult,
  fred: FredResult,
  freshness: MarketSnapshotFreshness,
) {
  if (!isKisSectorDegradedEnabled()) return false;
  if (kis.status !== "needs_data" || fred.status !== "ready") return false;
  if (!hasRequiredKisCore(kis)) return false;
  if (freshness.status !== "fresh" || freshness.staleItems.length > 0) return false;
  if (!kis.missingItems.length || kis.missingItems.some((item) => !isSectorMissingItem(item))) return false;
  return true;
}

export function isAllowedKisSectorDegradedSnapshot(snapshot?: MarketSnapshot) {
  return Boolean(
    snapshot
      && snapshot.provider === "kis-fred"
      && snapshot.status === "ready"
      && snapshot.dataQuality === "partial"
      && snapshot.degradedMode === KIS_SECTOR_DEGRADED_MODE
      && snapshot.degradedProviders?.includes(KIS_SECTOR_DEGRADED_PROVIDER)
      && snapshot.freshness?.status === "fresh"
      && snapshot.freshness.staleItems.length === 0
      && snapshot.disclosures?.includes(KIS_SECTOR_DEGRADED_DISCLOSURE),
  );
}

export function ensureKisSectorDegradedDisclosure(body: string, snapshot?: MarketSnapshot) {
  if (!isAllowedKisSectorDegradedSnapshot(snapshot) || body.includes(KIS_SECTOR_DEGRADED_DISCLOSURE)) return body;
  const trimmed = body.trimEnd();
  return `${trimmed}${trimmed ? "\n\n" : ""}${KIS_SECTOR_DEGRADED_DISCLOSURE}`;
}
