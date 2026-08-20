import test from "node:test";
import assert from "node:assert/strict";
import { evaluateStockBlogImageQuality } from "./stock-blog-image-quality";
import type { MarketSnapshot } from "./references/reference-types";
import {
  KIS_OVERSEAS_DEGRADED_DISCLOSURE,
  KIS_OVERSEAS_DEGRADED_MODE,
  KIS_OVERSEAS_DEGRADED_PROVIDER,
} from "./references/kis-overseas-degraded-policy";
import type { StockBlogContentImage } from "./stock-blog-image-types";

const snapshot: MarketSnapshot = {
  provider: "kis-fred", status: "ready", marketDate: "2026-07-19", collectedAt: "2026-07-19T00:00:00Z",
  dataQuality: "verified", fallbackUsed: false, freshness: { status: "fresh", checkedAt: "2026-07-19T00:00:00Z", staleItems: [] },
  korea: { kospi: { label: "KOSPI", changePct: -1.2, asOf: "2026-07-18", freshness: "fresh", sourceName: "KIS", url: "https://example.com/kis" } },
  us: {}, macro: {}, missingItems: [],
};

function image(id: string, role: "thumbnail" | "body", type: "thumbnail" | "chart"): StockBlogContentImage {
  const chart = type === "chart";
  return {
    id, role, type, title: id, placementAfterHeading: role === "body" ? `${id} heading` : "__thumbnail__",
    imageUrl: `/generated/stock-blog/p/${id}.svg`, caption: `${id} caption`, sourceLabel: "2026-07-18 | KIS",
    sourceName: "BG Market Note", licenseType: chart ? "generated-data-chart" : "generated", collectedAt: "2026-07-19",
    usageAllowed: true, dataKeys: chart ? ["korea.kospi.changePct"] : [],
    dataPoints: chart ? [{ key: "korea.kospi.changePct", label: "KOSPI", value: -1.2, unit: "%", asOf: "2026-07-18" }] : [],
    width: 1200, height: 675, fileFormat: "image/svg+xml", uploadFormat: "image/png", fileVerified: true,
  };
}

test("verified MarketSnapshot charts pass image quality audit", () => {
  const result = evaluateStockBlogImageQuality([image("thumbnail", "thumbnail", "thumbnail"), image("chart-1", "body", "chart"), image("chart-2", "body", "chart")], snapshot);
  assert.equal(result.status, "passed");
  assert.equal(result.chartImageCount, 2);
});

test("해외지수·환율 제외 모드는 확인된 국내 차트만 품질 검증한다", () => {
  const degradedSnapshot: MarketSnapshot = {
    ...snapshot,
    dataQuality: "partial",
    degradedMode: KIS_OVERSEAS_DEGRADED_MODE,
    degradedProviders: [KIS_OVERSEAS_DEGRADED_PROVIDER],
    disclosures: [KIS_OVERSEAS_DEGRADED_DISCLOSURE],
    missingItems: ["S&P 500", "NASDAQ", "Dow Jones", "USD/KRW"],
  };
  const result = evaluateStockBlogImageQuality([
    image("thumbnail", "thumbnail", "thumbnail"),
    image("domestic-index", "body", "chart"),
    image("domestic-flow", "body", "chart"),
  ], degradedSnapshot);
  assert.equal(result.status, "passed");
});

test("chart value mismatch blocks automatic publishing", () => {
  const mismatched = image("chart-1", "body", "chart");
  mismatched.dataPoints[0].value = 9.9;
  const result = evaluateStockBlogImageQuality([image("thumbnail", "thumbnail", "thumbnail"), mismatched, image("chart-2", "body", "chart")], snapshot);
  assert.equal(result.status, "blocked");
  assert.ok(result.issues.some((issue) => issue.code === "image_data_mismatch"));
});

test("전부 0인 KOSPI 투자자 수급 차트는 자동 발행을 차단한다", () => {
  const flowSnapshot: MarketSnapshot = {
    ...snapshot,
    korea: {
      ...snapshot.korea,
      investorFlows: ["외국인", "기관", "개인"].map((label) => ({
        label: `KOSPI ${label} 순매수`,
        value: 0,
        unit: "백만원",
        asOf: "2026-07-18",
        freshness: "fresh",
        sourceName: "KIS",
        url: "https://example.com/kis",
      })),
    },
  };
  const flowChart = image("kospi-investor-flow", "body", "chart");
  flowChart.dataKeys = [
    "korea.investorFlows.0.value",
    "korea.investorFlows.1.value",
    "korea.investorFlows.2.value",
  ];
  flowChart.dataPoints = flowChart.dataKeys.map((key, index) => ({
    key,
    label: ["외국인", "기관", "개인"][index],
    value: 0,
    unit: "백만원",
    asOf: "2026-07-18",
  }));

  const result = evaluateStockBlogImageQuality([
    image("thumbnail", "thumbnail", "thumbnail"),
    flowChart,
    image("chart-2", "body", "chart"),
  ], flowSnapshot);

  assert.equal(result.status, "blocked");
  assert.ok(result.issues.some((issue) => issue.message.includes("전부 0인 수급값")));
});

test("본문 이미지가 핵심 3장을 넘으면 정보 과밀로 차단한다", () => {
  const result = evaluateStockBlogImageQuality([
    image("thumbnail", "thumbnail", "thumbnail"),
    image("chart-1", "body", "chart"),
    image("chart-2", "body", "chart"),
    image("chart-3", "body", "chart"),
    image("chart-4", "body", "chart"),
  ], snapshot);

  assert.equal(result.status, "blocked");
  assert.match(result.issues.map((issue) => issue.message).join("\n"), /2~3장/);
});
