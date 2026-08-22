import test from "node:test";
import assert from "node:assert/strict";
import { parseFredMarketMetric } from "./fred-market-data-provider.ts";

test("FRED 미국지수 확정값과 전일 대비 등락률을 읽는다", () => {
  const result = parseFredMarketMetric({
    label: "S&P 500",
    seriesId: "SP500",
    collectedAt: "2026-08-22T00:00:00.000Z",
    body: {
      observations: [
        { date: "2026-08-21", value: "6500" },
        { date: "2026-08-20", value: "6400" },
      ],
    },
  });

  assert.equal(result?.metric.value, 6500);
  assert.equal(Number(result?.metric.changePct?.toFixed(4)), 1.5625);
  assert.equal(result?.metric.provider, "fred");
  assert.equal(result?.source.sourceName, "FRED · SP500");
});

test("FRED 결측 표시는 건너뛰고 최근 유효값 두 개를 비교한다", () => {
  const result = parseFredMarketMetric({
    label: "USD/KRW",
    seriesId: "DEXKOUS",
    collectedAt: "2026-08-22T00:00:00.000Z",
    body: {
      observations: [
        { date: "2026-08-22", value: "." },
        { date: "2026-08-21", value: "1386" },
        { date: "2026-08-20", value: "1390" },
      ],
    },
  });

  assert.equal(result?.metric.value, 1386);
  assert.ok((result?.metric.changePct ?? 0) < 0);
  assert.equal(result?.metric.asOf, "2026-08-21T00:00:00.000Z");
});
