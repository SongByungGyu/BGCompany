import test from "node:test";
import assert from "node:assert/strict";
import type { FredResult } from "./fred-macro-provider.ts";
import type { KisResult } from "./kis-market-data-provider.ts";
import {
  canUseKisSectorDegradedMode,
  ensureKisSectorDegradedDisclosure,
  isAllowedKisSectorDegradedSnapshot,
  KIS_SECTOR_DEGRADED_DISCLOSURE,
  KIS_SECTOR_DEGRADED_MODE,
  KIS_SECTOR_DEGRADED_PROVIDER,
} from "./kis-sector-degraded-policy.ts";
import type { MarketSnapshot, MarketSnapshotFreshness, MarketSnapshotMetric } from "./reference-types.ts";

const metric: MarketSnapshotMetric = {
  label: "verified",
  value: 1,
  asOf: "2026-07-27T00:00:00.000Z",
  freshness: "fresh",
  provider: "kis",
};
const freshness: MarketSnapshotFreshness = {
  status: "fresh",
  checkedAt: "2026-07-27T00:01:00.000Z",
  staleItems: [],
};
const fred: FredResult = {
  status: "ready",
  sources: [],
  missingItems: [],
};
const sectorOnlyGap: KisResult = {
  status: "needs_data",
  korea: {
    kospi: metric,
    kosdaq: metric,
    investorFlows: [metric],
    strongSectors: [],
    weakSectors: [],
  },
  us: {
    sp500: metric,
    nasdaq: metric,
    dow: metric,
    fx: metric,
  },
  sources: [],
  missingItems: ["KOSPI 강세/약세 업종", "국내 업종 흐름"],
};

test("sector-only KIS gaps use the disclosed degraded path", () => {
  assert.equal(canUseKisSectorDegradedMode(sectorOnlyGap, fred, freshness), true);
  assert.equal(
    canUseKisSectorDegradedMode(
      { ...sectorOnlyGap, missingItems: ["KOSPI"] },
      fred,
      freshness,
    ),
    false,
  );
});

test("sector-degraded snapshots require fresh core data and disclosure", () => {
  const snapshot: MarketSnapshot = {
    provider: "kis-fred",
    status: "ready",
    marketDate: "2026-07-27",
    collectedAt: freshness.checkedAt,
    dataQuality: "partial",
    degradedMode: KIS_SECTOR_DEGRADED_MODE,
    degradedProviders: [KIS_SECTOR_DEGRADED_PROVIDER],
    disclosures: [KIS_SECTOR_DEGRADED_DISCLOSURE],
    freshness,
    missingItems: sectorOnlyGap.missingItems,
  };
  assert.equal(isAllowedKisSectorDegradedSnapshot(snapshot), true);
  assert.match(ensureKisSectorDegradedDisclosure("본문", snapshot), /KIS 업종 등락 자료/);
});
