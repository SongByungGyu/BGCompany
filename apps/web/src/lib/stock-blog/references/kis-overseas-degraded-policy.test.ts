import test from "node:test";
import assert from "node:assert/strict";
import type { FredResult } from "./fred-macro-provider.ts";
import type { KisResult } from "./kis-market-data-provider.ts";
import {
  canUseKisOverseasDegradedMode,
  ensureKisOverseasDegradedDisclosure,
  isAllowedKisOverseasDegradedSnapshot,
  isKisOverseasDegradedCutoffReached,
  KIS_OVERSEAS_DEGRADED_DISCLOSURE,
  KIS_OVERSEAS_DEGRADED_MODE,
  KIS_OVERSEAS_DEGRADED_PROVIDER,
} from "./kis-overseas-degraded-policy.ts";
import type { MarketSnapshot, MarketSnapshotFreshness, MarketSnapshotMetric } from "./reference-types.ts";

const metric: MarketSnapshotMetric = {
  label: "verified",
  value: 1,
  asOf: "2026-08-20T00:00:00.000Z",
  freshness: "fresh",
  provider: "kis",
};
const freshness: MarketSnapshotFreshness = {
  status: "fresh",
  checkedAt: "2026-08-20T00:01:00.000Z",
  staleItems: [],
};
const fred: FredResult = {
  status: "ready",
  sources: [],
  missingItems: [],
  macro: { us2Year: metric, us10Year: metric },
  upcoming: [{ date: "2026-08-21", event: "미국 경제지표" }],
};
const overseasOnlyGap: KisResult = {
  status: "needs_data",
  korea: {
    kospi: metric,
    kosdaq: metric,
    investorFlows: [metric],
    strongSectors: ["반도체 1.00%"],
    weakSectors: ["운송 -1.00%"],
  },
  us: {},
  sources: [],
  missingItems: ["S&P 500", "NASDAQ", "Dow Jones", "USD/KRW"],
};

test("한국장 장전 글은 해외지수·환율만 비었을 때 누락 항목 제외 모드를 사용한다", () => {
  const afterCutoff = { now: new Date("2026-08-19T22:30:00Z"), cutoffKst: "07:30" };
  assert.equal(canUseKisOverseasDegradedMode("KOREA_DAILY_PREVIEW", overseasOnlyGap, fred, freshness, afterCutoff), true);
  assert.equal(canUseKisOverseasDegradedMode("INVESTMENT_STUDY", overseasOnlyGap, fred, freshness, afterCutoff), true);
  assert.equal(canUseKisOverseasDegradedMode("KOREA_MARKET_CLOSE_US_PREVIEW", overseasOnlyGap, fred, freshness, afterCutoff), false);
  assert.equal(
    canUseKisOverseasDegradedMode(
      "KOREA_DAILY_PREVIEW",
      { ...overseasOnlyGap, missingItems: ["S&P 500", "KOSPI"] },
      fred,
      freshness,
      afterCutoff,
    ),
    false,
  );
});

test("해외지수·환율 누락은 07:30 KST까지 재수집하고 마감 이후에만 제외한다", () => {
  assert.equal(isKisOverseasDegradedCutoffReached(new Date("2026-08-19T22:29:59Z"), "07:30"), false);
  assert.equal(isKisOverseasDegradedCutoffReached(new Date("2026-08-19T22:30:00Z"), "07:30"), true);
  assert.equal(
    canUseKisOverseasDegradedMode(
      "KOREA_DAILY_PREVIEW",
      overseasOnlyGap,
      fred,
      freshness,
      { now: new Date("2026-08-19T22:29:59Z"), cutoffKst: "07:30" },
    ),
    false,
  );
});

test("누락 항목 제외 snapshot은 최신 국내 핵심자료와 고지문을 요구한다", () => {
  const snapshot: MarketSnapshot = {
    provider: "kis-fred",
    status: "ready",
    marketDate: "2026-08-20",
    collectedAt: freshness.checkedAt,
    dataQuality: "partial",
    degradedMode: KIS_OVERSEAS_DEGRADED_MODE,
    degradedProviders: [KIS_OVERSEAS_DEGRADED_PROVIDER],
    disclosures: [KIS_OVERSEAS_DEGRADED_DISCLOSURE],
    freshness,
    korea: overseasOnlyGap.korea,
    macro: fred.macro,
    upcoming: fred.upcoming,
    missingItems: overseasOnlyGap.missingItems,
  };
  assert.equal(isAllowedKisOverseasDegradedSnapshot(snapshot), true);
  assert.match(ensureKisOverseasDegradedDisclosure("본문", snapshot), /관련 그래프는 제외/);
});
