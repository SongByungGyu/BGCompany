import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeKisDomesticHoldings,
  normalizeKisOverseasHoldings,
} from "./kis-account-normalizer.ts";

test("normalizes domestic KIS holdings and removes zero balances", () => {
  const result = normalizeKisDomesticHoldings([
    { pdno: "005930", prdt_name: "삼성전자", hldg_qty: "12", pchs_avg_pric: "70000.5", prpr: "81000" },
    { pdno: "000660", prdt_name: "SK하이닉스", hldg_qty: "0", pchs_avg_pric: "100000", prpr: "200000" },
  ]);
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
  }]);
});

test("normalizes overseas KIS holdings without exposing account fields", () => {
  const result = normalizeKisOverseasHoldings({
    ovrs_pdno: "spy",
    ovrs_item_name: "SPDR S&P 500 ETF",
    ovrs_cblc_qty: "1.25",
    pchs_avg_pric: "500.10",
    now_pric2: "550.25",
    cano: "12345678",
  });
  assert.equal(result.length, 1);
  assert.equal(result[0].symbol, "SPY");
  assert.equal(result[0].assetType, "ETF");
  assert.equal(result[0].quantity, "1.25");
  assert.equal("cano" in result[0], false);
});
