import test from "node:test";
import assert from "node:assert/strict";
import {
  buildMarketDataFallbackStudyPlan,
  getMarketDataFallbackStudyPublishKey,
} from "./market-data-fallback-study.ts";

test("오전 시장자료가 마감까지 비면 검색 질문형 투자공부 주제를 고른다", () => {
  const plan = buildMarketDataFallbackStudyPlan({
    marketDate: "2026-08-22",
    sourceContentType: "WEEKLY_MARKET_REVIEW",
  });
  assert.match(plan.sourceTitle, /왜|어떻게|읽는 법|확인법/);
  assert.match(plan.topic, /지연된 항목은 수치와 그래프에서 제외/);
  assert.ok(plan.keywords.includes("주식 투자 공부"));
});

test("원래 오전 글과 대체 공부 글은 별도 발행키를 사용한다", () => {
  assert.equal(
    getMarketDataFallbackStudyPublishKey("2026-08-22", "09:00"),
    "INVESTMENT_STUDY_DATA_FALLBACK:2026-08-22:09:00",
  );
});
