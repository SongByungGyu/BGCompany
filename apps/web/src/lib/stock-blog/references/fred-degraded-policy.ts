import type { FredResult } from "./fred-macro-provider";
import type { KisResult } from "./kis-market-data-provider";
import type { MarketSnapshot, MarketSnapshotFreshness } from "./reference-types";

export const FRED_DEGRADED_MODE = "fred_unavailable" as const;
export const FRED_DEGRADED_DISCLOSURE = "FRED 거시지표 조회 지연으로 미국 국채금리 또는 경제지표 일정 일부를 이번 브리핑에서 제외했습니다.";

const TRANSIENT_CODES = new Set([
  // Credential failures are degradable only after the official-source
  // supplement has produced at least one usable source. A completely empty
  // needs_credentials result is still rejected below.
  "FRED_AUTH_FAILED",
  "FRED_TIMEOUT",
  "FRED_NETWORK_FAILED",
  "FRED_RATE_LIMITED",
  "OFFICIAL_US_TIMEOUT",
  "OFFICIAL_US_NETWORK_FAILED",
  "OFFICIAL_US_RATE_LIMITED",
  // BLS currently rejects some server-side calendar requests with 403. This
  // may omit the calendar only; Treasury data must still be present.
  "OFFICIAL_US_HTTP_403",
]);

function isTransientCode(code: string) {
  if (TRANSIENT_CODES.has(code)) return true;
  const match = code.match(/^(?:FRED|OFFICIAL_US)_HTTP_(\d{3})$/);
  return Boolean(match && Number(match[1]) >= 500);
}

export function isFredDegradedEnabled() {
  // Keep article generation available during a FRED-only outage by default.
  // Operators can restore fail-closed behavior explicitly with "false".
  return process.env.STOCK_MARKET_DATA_ALLOW_FRED_DEGRADED !== "false";
}

export function canUseFredDegradedMode(kis: KisResult, fred: FredResult, freshness: MarketSnapshotFreshness) {
  if (!isFredDegradedEnabled()) return false;
  if (kis.status !== "ready" || freshness.status !== "fresh" || freshness.staleItems.length > 0) return false;
  if (fred.status === "ready" || fred.status === "needs_credentials") return false;
  if (fred.sources.length === 0) return false;
  const diagnostics = fred.diagnostics ?? [];
  if (diagnostics.some((item) => !isTransientCode(item.code))) return false;
  if (fred.status === "needs_data") return true;
  if (fred.status !== "error") return false;
  return diagnostics.length > 0;
}

export function isAllowedFredDegradedSnapshot(snapshot?: MarketSnapshot) {
  return Boolean(
    snapshot
      && snapshot.provider === "kis-fred"
      && snapshot.status === "ready"
      && snapshot.dataQuality === "partial"
      && snapshot.degradedMode === FRED_DEGRADED_MODE
      && snapshot.degradedProviders?.includes("fred")
      && snapshot.freshness?.status === "fresh"
      && snapshot.freshness.staleItems.length === 0
      && snapshot.disclosures?.includes(FRED_DEGRADED_DISCLOSURE),
  );
}

export function ensureFredDegradedDisclosure(body: string, snapshot?: MarketSnapshot) {
  if (!isAllowedFredDegradedSnapshot(snapshot) || body.includes(FRED_DEGRADED_DISCLOSURE)) return body;
  const trimmed = body.trimEnd();
  return `${trimmed}${trimmed ? "\n\n" : ""}${FRED_DEGRADED_DISCLOSURE}`;
}
