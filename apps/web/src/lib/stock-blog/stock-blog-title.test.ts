import test from "node:test";
import assert from "node:assert/strict";
import { buildStockBlogEditorialTitle, selectBestStockBlogEditorialTitle } from "./stock-blog-title.ts";

test("날짜와 시장이 들어간 완성형 미국장 제목은 검색어를 앞에 두고 날짜를 뒤로 옮긴다", () => {
  const title = "2026년 7월 20일 오늘 미국장 전망｜나스닥·미국 10년물·실적 일정";
  assert.equal(buildStockBlogEditorialTitle({
    template: "KOREA_MARKET_CLOSE_US_PREVIEW",
    marketDate: "2026-07-20",
    sourceTitle: title,
  }), "오늘 미국장 전망｜나스닥·미국 10년물·실적 일정｜7월 20일");
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

test("주간 제목을 다시 편집해도 주차 접미사를 한 번만 남긴다", () => {
  const title = buildStockBlogEditorialTitle({
    template: "WEEKLY_MARKET_REVIEW",
    marketDate: "2026-08-01",
    sourceTitle: "코스피 급등 원인과 외국인 수급｜8월 1주차｜8월 1주차",
  });
  assert.equal(title, "코스피 급등 원인과 외국인 수급｜8월 1주차");
});

test("제목 후보는 검색 의도가 구체적이고 최근 제목과 덜 겹치는 안을 선택한다", () => {
  const selected = selectBestStockBlogEditorialTitle({
    template: "KOREA_MARKET_CLOSE_US_PREVIEW",
    marketDate: "2026-08-03",
    candidates: [
      "오늘 미국장 전망: 나스닥과 미국 10년물 금리",
      "오늘 코스피 마감 원인: 외국인 수급과 반도체",
      "코스피 마감 정리",
    ],
    recentTitles: ["코스피 마감 정리｜8월 2일"],
  });
  assert.match(selected.title, /오늘 미국장 전망: 나스닥과 미국 10년물 금리/);
  assert.equal(selected.candidates.length, 3);
});

test("투자 공부 제목은 시장명이 없어도 당일 이슈 검색어와 질문을 그대로 유지한다", () => {
  assert.equal(buildStockBlogEditorialTitle({
    template: "INVESTMENT_STUDY",
    marketDate: "2026-08-13",
    sourceTitle: "PPI 발표 뒤 금리와 성장주는 왜 함께 움직일까",
  }), "PPI 발표 뒤 금리와 성장주는 왜 함께 움직일까｜8월 13일 기준");
});

test("경제 일정 검색형 제목은 포괄적인 투자 공부 문구를 붙이지 않는다", () => {
  assert.equal(buildStockBlogEditorialTitle({
    template: "INVESTMENT_STUDY",
    marketDate: "2026-08-18",
    sourceTitle: "미국 CPI 발표시간, 예상보다 높으면 나스닥은 왜 흔들릴까",
  }), "미국 CPI 발표시간, 예상보다 높으면 나스닥은 왜 흔들릴까｜8월 18일 기준");
});

test("청년미래적금 검색형 제목은 중간을 말줄임표로 자르지 않는다", () => {
  assert.equal(buildStockBlogEditorialTitle({
    template: "INVESTMENT_STUDY",
    marketDate: "2026-09-02",
    sourceTitle: "청년미래적금 9월 추가 모집 언제? 현행 6%·12%와 15% 상향안",
  }), "청년미래적금 9월 추가 모집 언제? 현행 6%·12%와 15% 상향안｜9월 2일 기준");
});

test("투자 공부 대제목은 새 검색 주제마다 고정 접두어 없이 유지한다", () => {
  assert.equal(buildStockBlogEditorialTitle({
    template: "INVESTMENT_STUDY",
    marketDate: "2026-09-03",
    sourceTitle: "배당소득 분리과세가 바뀌면 어떤 숫자부터 봐야 할까",
  }), "배당소득 분리과세가 바뀌면 어떤 숫자부터 봐야 할까｜9월 3일 기준");
});

test("유상증자 질문형 제목은 포괄적인 주식 기초 제목으로 바꾸지 않는다", () => {
  assert.equal(buildStockBlogEditorialTitle({
    template: "INVESTMENT_STUDY",
    marketDate: "2026-08-20",
    sourceTitle: "유상증자 공시가 나오면 주가는 왜 떨어질까? 엘비세미콘 숫자 6개",
  }), "유상증자 공시가 나오면 주가는 왜 떨어질까? 엘비세미콘 숫자 6개｜8월 20일 기준");
});

test("유상증자 질문형 후보는 포괄적인 투자 공부 대체 제목보다 우선한다", () => {
  const sourceTitle = "유상증자 공시가 나오면 주가는 왜 떨어질까? 엘비세미콘 숫자 6개";
  const selected = selectBestStockBlogEditorialTitle({
    template: "INVESTMENT_STUDY",
    marketDate: "2026-08-20",
    candidates: [
      sourceTitle,
      sourceTitle,
      sourceTitle,
      "주식 기초 공부: 숫자로 이해하는 투자 개념",
    ],
  });
  assert.equal(selected.title, `${sourceTitle}｜8월 20일 기준`);
});
