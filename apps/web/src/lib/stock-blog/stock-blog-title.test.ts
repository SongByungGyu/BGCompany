import test from "node:test";
import assert from "node:assert/strict";
import { buildStockBlogEditorialTitle } from "./stock-blog-title";

test("날짜와 시장이 들어간 완성형 에디터 제목은 중복 접두어 없이 보존한다", () => {
  const title = "2026년 7월 20일 한국 증시 마감｜코스피 급락·환율·미국 10년물로 보는 오늘 밤 미국 증시";
  assert.equal(buildStockBlogEditorialTitle({
    template: "KOREA_MARKET_CLOSE_US_PREVIEW",
    marketDate: "2026-07-20",
    sourceTitle: title,
  }), title);
});

test("완성형 제목이 없으면 기존 템플릿 접두어를 사용한다", () => {
  assert.equal(buildStockBlogEditorialTitle({
    template: "KOREA_MARKET_CLOSE_US_PREVIEW",
    marketDate: "2026-07-20",
    sourceTitle: "반도체와 환율 체크",
  }), "7/20 오늘의 미국장 전망 반도체와 환율 체크");
});
