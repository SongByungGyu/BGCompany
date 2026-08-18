import test from "node:test";
import assert from "node:assert/strict";
import {
  buildHolidaySearchStudyPlan,
  getHolidaySearchStudyPublishKey,
} from "./holiday-search-study.ts";

test("국장 휴장일을 자연스러운 검색 질문형 투자공부 주제로 바꾼다", () => {
  const plan = buildHolidaySearchStudyPlan({
    session: {
      market: "KRX",
      marketDate: "2026-08-17",
      state: "closed",
      source: "kis-ctca0903r",
      reason: "KIS가 국내 증시 휴장일로 확인했습니다.",
    },
    nextOpenDate: "2026-08-18",
  });

  assert.equal(plan?.market, "KR");
  assert.match(plan?.sourceTitle ?? "", /오늘 국내 주식시장 휴장인가요/);
  assert.match(plan?.topic ?? "", /2026-08-18/);
  assert.ok(plan?.keywords.includes("주식 주문 가능 여부"));
});

test("미장 휴장일에는 한국시간과 다음 개장일 검색 의도를 사용한다", () => {
  const plan = buildHolidaySearchStudyPlan({
    session: {
      market: "NYSE",
      marketDate: "2026-09-07",
      state: "closed",
      source: "nyse-rule-calendar",
      reason: "미국 거래소 정규 휴장일입니다.",
    },
    nextOpenDate: "2026-09-08",
  });

  assert.equal(plan?.market, "US");
  assert.match(plan?.sourceTitle ?? "", /오늘 미국장 휴장인가요/);
  assert.ok(plan?.keywords.includes("미국장 개장시간"));
});

test("개장일은 휴장 대체 글을 만들지 않는다", () => {
  assert.equal(buildHolidaySearchStudyPlan({
    session: {
      market: "NYSE",
      marketDate: "2026-08-18",
      state: "open",
      source: "nyse-rule-calendar",
      reason: "미국 거래소 정규 개장일입니다.",
    },
  }), null);
});

test("국장과 미장이 함께 쉬어도 날짜당 같은 발행키를 사용한다", () => {
  assert.equal(
    getHolidaySearchStudyPublishKey("2026-12-25"),
    "INVESTMENT_STUDY_HOLIDAY:2026-12-25",
  );
});
