import test from "node:test";
import assert from "node:assert/strict";
import {
  getKisMarketFreshnessMinutes,
  parseKisKoreaMarketCalendar,
  rememberKisKoreaMarketSession,
  resetKisKoreaMarketSessionCacheForTests,
  selectKisCompletedDomesticIndexRow,
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

test("운영자 휴장일 지정도 다음 개장일 데이터 수명에 반영한다", () => {
  resetKisKoreaMarketSessionCacheForTests();
  const tuesdayMorningKst = new Date("2026-08-17T23:00:00.000Z");
  assert.equal(getKisMarketFreshnessMinutes(tuesdayMorningKst, {
    ...ENV,
    KIS_HOLIDAY_MAX_AGE_MINUTES: "10080",
    STOCK_BLOG_KRX_CLOSED_DATES: "2026-08-17",
  }), 10080);
  resetKisKoreaMarketSessionCacheForTests();
});

test("오전 국내 지수는 당일 0% 행 대신 직전 거래일 확정값을 고른다", () => {
  const row = selectKisCompletedDomesticIndexRow([
    { stck_bsop_date: "20260825", bstp_nmix_prpr: "0", bstp_nmix_prdy_ctrt: "0.00" },
    { stck_bsop_date: "20260824", bstp_nmix_prpr: "7321.45", bstp_nmix_prdy_ctrt: "1.23" },
    { stck_bsop_date: "20260821", bstp_nmix_prpr: "7232.49", bstp_nmix_prdy_ctrt: "-0.44" },
  ], "20260825");

  assert.equal(row?.stck_bsop_date, "20260824");
  assert.equal(row?.bstp_nmix_prdy_ctrt, "1.23");
});

test("휴장일 0% 행이 섞이면 그 이전 실제 영업일 확정값을 고른다", () => {
  resetKisKoreaMarketSessionCacheForTests();
  rememberKisKoreaMarketSession("20260817", false);
  const row = selectKisCompletedDomesticIndexRow([
    { stck_bsop_date: "20260818", bstp_nmix_prpr: "0", bstp_nmix_prdy_ctrt: "0.00" },
    { stck_bsop_date: "20260817", bstp_nmix_prpr: "7280.12", bstp_nmix_prdy_ctrt: "0.00" },
    { stck_bsop_date: "20260814", bstp_nmix_prpr: "7280.12", bstp_nmix_prdy_ctrt: "-0.57" },
  ], "20260818");

  assert.equal(row?.stck_bsop_date, "20260814");
  assert.equal(row?.bstp_nmix_prdy_ctrt, "-0.57");
  resetKisKoreaMarketSessionCacheForTests();
});

test("월요일 오전에는 주말 행을 건너뛰고 금요일 확정값을 고른다", () => {
  const row = selectKisCompletedDomesticIndexRow([
    { stck_bsop_date: "20260824", bstp_nmix_prpr: "0", bstp_nmix_prdy_ctrt: "0.00" },
    { stck_bsop_date: "20260823", bstp_nmix_prpr: "7200", bstp_nmix_prdy_ctrt: "0.00" },
    { stck_bsop_date: "20260822", bstp_nmix_prpr: "7200", bstp_nmix_prdy_ctrt: "0.00" },
    { stck_bsop_date: "20260821", bstp_nmix_prpr: "7200", bstp_nmix_prdy_ctrt: "0.31" },
  ], "20260824");

  assert.equal(row?.stck_bsop_date, "20260821");
});
