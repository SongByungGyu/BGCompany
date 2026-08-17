import test from "node:test";
import assert from "node:assert/strict";
import {
  getKisMarketFreshnessMinutes,
  parseKisKoreaMarketCalendar,
  rememberKisKoreaMarketSession,
  resetKisKoreaMarketSessionCacheForTests,
} from "./kis-market-data-provider.ts";

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

test("KIS 국내 휴장일 응답에서 실제 개장 여부를 읽는다", () => {
  assert.deepEqual(parseKisKoreaMarketCalendar([
    { bass_dt: "20260817", bzdy_yn: "N", tr_day_yn: "Y", opnd_yn: "N", sttl_day_yn: "N" },
    { bass_dt: "20260818", bzdy_yn: "Y", tr_day_yn: "Y", opnd_yn: "Y", sttl_day_yn: "Y" },
    { bass_dt: "invalid", opnd_yn: "Y" },
  ]), [
    { marketDate: "20260817", isOpen: false, isBusinessDay: false, isTradingDay: true, isSettlementDay: false },
    { marketDate: "20260818", isOpen: true, isBusinessDay: true, isTradingDay: true, isSettlementDay: true },
  ]);
});

test("휴장 다음 개장일에는 마지막 실제 거래일 데이터의 수명을 연장한다", () => {
  resetKisKoreaMarketSessionCacheForTests();
  rememberKisKoreaMarketSession("20260817", false);
  const tuesdayMorningKst = new Date("2026-08-17T23:00:00.000Z");
  assert.equal(getKisMarketFreshnessMinutes(tuesdayMorningKst, {
    ...ENV,
    KIS_HOLIDAY_MAX_AGE_MINUTES: "10080",
  }), 10080);
  resetKisKoreaMarketSessionCacheForTests();
});
