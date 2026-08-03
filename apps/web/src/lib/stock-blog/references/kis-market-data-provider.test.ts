import test from "node:test";
import assert from "node:assert/strict";
import { getKisMarketFreshnessMinutes } from "./kis-market-data-provider.ts";

const ENV = {
  KIS_MARKET_MAX_AGE_MINUTES: "4320",
  KIS_WEEKEND_MAX_AGE_MINUTES: "5760",
};

test("월요일 미국장 개장 전에는 주말 최대 수명으로 금요일 종가를 허용한다", () => {
  const mondayKst = new Date("2026-08-03T08:00:00.000Z");
  assert.equal(getKisMarketFreshnessMinutes(mondayKst, ENV), 5760);
});

test("화요일부터는 기본 최대 수명으로 복귀한다", () => {
  const tuesdayKst = new Date("2026-08-04T08:00:00.000Z");
  assert.equal(getKisMarketFreshnessMinutes(tuesdayKst, ENV), 4320);
});

test("주말 설정값은 기본값보다 짧아질 수 없다", () => {
  const sundayKst = new Date("2026-08-02T03:00:00.000Z");
  assert.equal(getKisMarketFreshnessMinutes(sundayKst, {
    KIS_MARKET_MAX_AGE_MINUTES: "6000",
    KIS_WEEKEND_MAX_AGE_MINUTES: "120",
  }), 6000);
});
