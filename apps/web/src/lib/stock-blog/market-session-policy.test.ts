import test from "node:test";
import assert from "node:assert/strict";
import {
  evaluateStockBlogMarketSession,
  getConfiguredMarketDateOverride,
  getKrxMarketSession,
  getNyseMarketSession,
} from "./market-session-policy.ts";

test("국장은 검토된 휴장 목록을 사용하고 KIS 응답 없이 평일 개장을 판정한다", () => {
  const reviewedCalendar = {
    closedDates: "2026-08-17,2026-09-24,2026-09-25",
  };
  assert.equal(getKrxMarketSession("2026-08-17", reviewedCalendar).state, "closed");
  assert.equal(getKrxMarketSession("2026-08-19", reviewedCalendar).state, "open");
  assert.equal(getKrxMarketSession("2026-08-22", reviewedCalendar).state, "closed");
  assert.equal(getKrxMarketSession("2026-08-19", reviewedCalendar).source, "krx-reviewed-calendar");
});

test("미국 거래소 정규 휴장일과 개장일을 구분한다", () => {
  assert.equal(getNyseMarketSession("2026-09-07").state, "closed");
  assert.equal(getNyseMarketSession("2026-08-17").state, "open");
});

test("다음 해 신정의 전년도 대체휴일까지 판정한다", () => {
  assert.equal(getNyseMarketSession("2027-12-31").state, "closed");
});

test("운영자 예외 개장일과 휴장일을 우선 적용한다", () => {
  assert.equal(getNyseMarketSession("2026-08-17", { closedDates: "2026-08-17" }).state, "closed");
  assert.equal(getNyseMarketSession("2026-09-07", { openDates: "2026-09-07" }).state, "open");
  assert.equal(getConfiguredMarketDateOverride({
    market: "KRX",
    marketDate: "2026-08-17",
    closedDates: "2026-08-17",
    openDates: "2026-08-17",
  })?.state, "unknown");
});

test("한국장 전망은 KRX 휴장에 건너뛰고 미국장 전망은 NYSE 개장 시 실행한다", () => {
  const korea = evaluateStockBlogMarketSession({
    contentType: "KOREA_DAILY_PREVIEW",
    session: { market: "KRX", marketDate: "2026-08-17", state: "closed", source: "krx-reviewed-calendar", reason: "국내 증시 휴장입니다." },
  });
  const us = evaluateStockBlogMarketSession({
    contentType: "KOREA_MARKET_CLOSE_US_PREVIEW",
    session: getNyseMarketSession("2026-08-17"),
  });
  assert.equal(korea.action, "skip");
  assert.equal(us.action, "run");
});

test("개장 여부를 확인하지 못한 시장 의존 글은 발행하지 않고 보류한다", () => {
  assert.equal(evaluateStockBlogMarketSession({ contentType: "KOREA_DAILY_PREVIEW" }).action, "defer");
  assert.equal(evaluateStockBlogMarketSession({ contentType: "INVESTMENT_STUDY" }).action, "run");
});
