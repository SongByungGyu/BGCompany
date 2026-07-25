import assert from "node:assert/strict";
import test from "node:test";
import { normalizeTossHoldings } from "./toss-account-normalizer.ts";

test("normalizes official Toss holdings and removes zero balances", () => {
  const result = normalizeTossHoldings({
    items: [
      {
        symbol: "005930",
        name: "삼성전자",
        marketCountry: "KR",
        currency: "KRW",
        quantity: "12",
        lastPrice: "81000",
        averagePurchasePrice: "70000.5",
        accountNo: "must-not-leak",
      },
      {
        symbol: "000660",
        name: "SK하이닉스",
        marketCountry: "KR",
        currency: "KRW",
        quantity: "0",
        lastPrice: "200000",
        averagePurchasePrice: "100000",
      },
    ],
  });
  assert.deepEqual(result, [{
    market: "KR",
    symbol: "005930",
    name: "삼성전자",
    assetType: "stock",
    quantity: "12",
    averagePrice: "70000.5",
    currency: "KRW",
    sector: "미분류",
    currentPrice: "81000",
    analysis: null,
    dividendTrackingEnabled: false,
  }]);
  assert.equal("accountNo" in result[0], false);
});

test("normalizes a US ETF without retaining unknown response fields", () => {
  const [holding] = normalizeTossHoldings([{
    symbol: "spy",
    name: "SPDR S&P 500 ETF",
    marketCountry: "US",
    currency: "USD",
    quantity: 1.25,
    lastPrice: 550.25,
    averagePurchasePrice: 500.1,
    profitLoss: { amount: 50.15 },
  }]);
  assert.equal(holding.symbol, "SPY");
  assert.equal(holding.assetType, "ETF");
  assert.equal(holding.quantity, "1.25");
  assert.equal(holding.dividendTrackingEnabled, false);
  assert.equal("profitLoss" in holding, false);
});

test("classifies a known leveraged ETF from its official profile", () => {
  const [holding] = normalizeTossHoldings([{
    symbol: "SOXL",
    name: "SOXL",
    marketCountry: "US",
    currency: "USD",
    quantity: "2",
    lastPrice: "150",
    averagePurchasePrice: "100",
  }]);
  assert.equal(holding.assetType, "ETF");
  assert.equal(holding.name, "Direxion Daily Semiconductor Bull 3X ETF");
  assert.equal(holding.sector, "반도체 3배 레버리지 ETF");
  assert.equal(holding.dividendTrackingEnabled, true);
  assert.match(holding.analysis ?? "", /일일 재설정/);
});
