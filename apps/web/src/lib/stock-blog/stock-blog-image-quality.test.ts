import test from "node:test";
import assert from "node:assert/strict";
import { evaluateStockBlogImageQuality } from "./stock-blog-image-quality";
import type { MarketSnapshot } from "./references/reference-types";
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

test("chart value mismatch blocks automatic publishing", () => {
  const mismatched = image("chart-1", "body", "chart");
  mismatched.dataPoints[0].value = 9.9;
  const result = evaluateStockBlogImageQuality([image("thumbnail", "thumbnail", "thumbnail"), mismatched, image("chart-2", "body", "chart")], snapshot);
  assert.equal(result.status, "blocked");
  assert.ok(result.issues.some((issue) => issue.code === "image_data_mismatch"));
});
