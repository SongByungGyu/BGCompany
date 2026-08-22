import test from "node:test";
import assert from "node:assert/strict";
import { buildAutomaticMarketSnapshot } from "./market-snapshot-provider.ts";
import type { FredResult } from "./fred-macro-provider.ts";
import type { FredMarketResult } from "./fred-market-data-provider.ts";
import type { KisResult } from "./kis-market-data-provider.ts";
import type { MarketSnapshotMetric, MarketSnapshotSource } from "./reference-types.ts";

const collectedAt = "2026-08-22T00:10:00.000Z";
const source = (provider: "kis" | "fred", name: string): MarketSnapshotSource => ({
  provider,
  sourceName: name,
  url: `https://example.com/${encodeURIComponent(name)}`,
  asOf: "2026-08-21T00:00:00.000Z",
  collectedAt,
  freshness: "fresh",
  ageMinutes: 1450,
  maxAgeMinutes: 5760,
});
const metric = (label: string, provider: "kis" | "fred"): MarketSnapshotMetric => ({
  label,
  value: 1,
  changePct: 0.1,
  asOf: "2026-08-21T00:00:00.000Z",
  collectedAt,
  freshness: "fresh",
  ageMinutes: 1450,
  maxAgeMinutes: 5760,
  provider,
  sourceName: `${provider}-${label}`,
  url: `https://example.com/${provider}/${encodeURIComponent(label)}`,
});

test("KIS 해외 네 항목이 비면 FRED 공식 시계열로 완성한다", () => {
  const kis: KisResult = {
    status: "needs_data",
    korea: {
      kospi: metric("KOSPI", "kis"),
      kosdaq: metric("KOSDAQ", "kis"),
      investorFlows: [metric("KOSPI 외국인 순매수", "kis")],
      strongSectors: ["반도체 1.00%"],
      weakSectors: ["운송 -1.00%"],
    },
    us: {},
    sources: [source("kis", "KIS domestic")],
    missingItems: ["S&P 500", "NASDAQ", "Dow Jones", "USD/KRW"],
    diagnostics: [{ item: "S&P 500", code: "KIS_TIMEOUT" }],
  };
  const fred: FredResult = {
    status: "ready",
    macro: { us2Year: metric("미국 2년물 국채금리", "fred"), us10Year: metric("미국 10년물 국채금리", "fred") },
    upcoming: [{ date: "2026-08-25", event: "미국 경제지표" }],
    sources: [source("fred", "FRED macro")],
    missingItems: [],
  };
  const fredMarket: FredMarketResult = {
    status: "ready",
    us: {
      sp500: metric("S&P 500", "fred"),
      nasdaq: metric("NASDAQ", "fred"),
      dow: metric("Dow Jones", "fred"),
      fx: metric("USD/KRW", "fred"),
    },
    sources: [source("fred", "FRED market")],
    missingItems: [],
    diagnostics: [{ provider: "fred", item: "S&P 500", code: "FRED_MARKET_FALLBACK_USED", recovered: true }],
  };

  const snapshot = buildAutomaticMarketSnapshot(kis, fred, "WEEKLY_MARKET_REVIEW", collectedAt, fredMarket);
  assert.equal(snapshot.status, "ready");
  assert.equal(snapshot.dataQuality, "verified");
  assert.equal(snapshot.us?.sp500?.provider, "fred");
  assert.deepEqual(snapshot.missingItems, []);
  assert.ok(snapshot.diagnostics?.some((item) => item.code === "KIS_TIMEOUT"));
  assert.ok(snapshot.diagnostics?.some((item) => item.code === "FRED_MARKET_FALLBACK_USED"));
});
