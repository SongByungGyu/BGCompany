import test from "node:test";
import assert from "node:assert/strict";
import { buildStockBlogEditorialTitle } from "./stock-blog-title.ts";

test("날짜와 시장이 들어간 완성형 에디터 제목은 검색어를 앞에 두고 날짜를 뒤로 옮긴다", () => {
  const title = "2026년 7월 20일 한국 증시 마감｜코스피 급락·환율·미국 10년물로 보는 오늘 밤 미국 증시";
  assert.equal(buildStockBlogEditorialTitle({
    template: "KOREA_MARKET_CLOSE_US_PREVIEW",
    marketDate: "2026-07-20",
    sourceTitle: title,
  }), "한국 증시 마감｜코스피 급락·환율·미국 10년물로 보는 오늘 밤 미국 증시｜7월 20일");
});

test("완성형 제목이 없으면 시장 의도와 날짜 후행 형식을 사용한다", () => {
  assert.equal(buildStockBlogEditorialTitle({
    template: "KOREA_MARKET_CLOSE_US_PREVIEW",
    marketDate: "2026-07-20",
    sourceTitle: "반도체와 환율 체크",
  }), "오늘 미국장 전망｜반도체와 환율 체크｜7월 20일");
});

test("짧은 날짜로 시작하는 기존 제목도 날짜 중복 없이 정리한다", () => {
  assert.equal(buildStockBlogEditorialTitle({
    template: "KOREA_DAILY_PREVIEW",
    marketDate: "26/07/29",
    sourceTitle: "7/29 오늘의 한국 증시 장전 브리핑: 코스피·환율·반도체 체크포인트",
  }), "오늘의 한국 증시 장전 브리핑: 코스피·환율·반도체 체크포인트｜7월 29일");
});
