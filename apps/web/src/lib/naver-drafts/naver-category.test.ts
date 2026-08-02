import test from "node:test";
import assert from "node:assert/strict";
import { resolveStockBriefingNaverCategory } from "./naver-category.ts";

test("예약 템플릿을 네이버 실제 카테고리명으로 매핑한다", () => {
  assert.equal(resolveStockBriefingNaverCategory("KOREA_DAILY_PREVIEW", "주식시장 브리핑"), "오늘의 한국장 전망");
  assert.equal(resolveStockBriefingNaverCategory("KOREA_MARKET_CLOSE_US_PREVIEW", "주식시장 브리핑"), "오늘의 미국장 전망");
  assert.equal(resolveStockBriefingNaverCategory("WEEKLY_MARKET_REVIEW", "주식시장 브리핑"), "주간 시장 정리");
  assert.equal(resolveStockBriefingNaverCategory("NEXT_WEEK_MARKET_PREVIEW", "주식시장 브리핑"), "차주 시장 전망");
});

test("네이버에 실제 존재하는 명시적 카테고리는 그대로 유지한다", () => {
  assert.equal(resolveStockBriefingNaverCategory("KOREA_DAILY_PREVIEW", "투자 공부"), "투자 공부");
  assert.equal(resolveStockBriefingNaverCategory("KOREA_DAILY_PREVIEW", "공시/실적 체크"), "공시/실적 체크");
});
