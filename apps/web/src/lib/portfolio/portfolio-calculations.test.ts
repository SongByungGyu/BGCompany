import assert from "node:assert/strict";
import test from "node:test";
import {
  allocationBy,
  annualDividend,
  applyPortfolioWeights,
  calculateHolding,
  dedupeNews,
  evaluatePortfolioRisks,
} from "./portfolio-calculations.ts";

const krHolding = {
  id: "kr-1",
  market: "KR" as const,
  symbol: "000000",
  name: "테스트 국내주",
  sector: "반도체",
  currency: "KRW" as const,
  quantity: "3",
  averagePrice: "10000.10",
};

test("평가금액·원가·손익·수익률을 Decimal로 계산한다", () => {
  const result = calculateHolding(krHolding, { price: "11000.20", freshnessStatus: "fresh" }, "KRW");
  assert.equal(result.nativeMarketValue?.toString(), "33000.6");
  assert.equal(result.nativeCostBasis.toString(), "30000.3");
  assert.equal(result.nativeProfitLoss?.toString(), "3000.3");
  assert.equal(result.returnPercent?.toDecimalPlaces(6).toString(), "10.0009");
});

test("USD 자산의 USD 및 KRW 환산 손익을 계산한다", () => {
  const result = calculateHolding(
    { ...krHolding, id: "us-1", market: "US", symbol: "TEST", currency: "USD", quantity: "2.5", averagePrice: "100.25" },
    { price: "112.5", freshnessStatus: "fresh" },
    "KRW",
    "1375.50",
  );
  assert.equal(result.nativeProfitLoss?.toString(), "30.625");
  assert.equal(result.baseMarketValue?.toString(), "386859.375");
  assert.equal(result.baseProfitLoss?.toString(), "42124.6875");
});

test("종목 및 섹터 비중과 집중 위험을 계산한다", () => {
  const first = calculateHolding(krHolding, { price: "100", freshnessStatus: "fresh" }, "KRW");
  const second = calculateHolding({ ...krHolding, id: "kr-2", symbol: "000001", name: "테스트 2", sector: "금융", quantity: "1" }, { price: "100", freshnessStatus: "fresh" }, "KRW");
  const weighted = applyPortfolioWeights([first, second]);
  assert.equal(weighted[0].weightPercent?.toString(), "75");
  assert.equal(allocationBy(weighted, (value) => value.holding.sector)[0].key, "반도체");
  const risks = evaluatePortfolioRisks(weighted, new Map([
    ["KR:000000", { price: "100", freshnessStatus: "fresh" }],
    ["KR:000001", { price: "100", freshnessStatus: "fresh" }],
  ]));
  assert.equal(risks.some((risk) => risk.type === "holding_concentration" && risk.severity === "high"), true);
  assert.equal(risks.some((risk) => risk.type === "sector_concentration" && risk.severity === "high"), true);
});

test("stale 시세는 잠정값과 데이터 위험으로 처리한다", () => {
  const calculated = applyPortfolioWeights([calculateHolding(krHolding, { price: "100", freshnessStatus: "stale" }, "KRW")]);
  assert.equal(calculated[0].provisional, true);
  const risks = evaluatePortfolioRisks(calculated, new Map([["KR:000000", { price: "100", freshnessStatus: "stale" }]]));
  assert.equal(risks.some((risk) => risk.type === "price_freshness"), true);
});

test("배당 상태를 유지하고 미확인 배당을 계산하지 않는다", () => {
  assert.equal(annualDividend("10", "2.5", "estimated")?.toString(), "25");
  assert.equal(annualDividend("10", null, "unavailable"), null);
});

test("뉴스 URL 중복을 제거한다", () => {
  const item = { url: "https://example.com/a", title: "기사", sourceName: "출처" };
  assert.equal(dedupeNews([item, { ...item }]).length, 1);
});
