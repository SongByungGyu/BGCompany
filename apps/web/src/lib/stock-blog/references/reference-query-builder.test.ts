import test from "node:test";
import assert from "node:assert/strict";
import { buildReferenceQueries } from "./reference-query-builder.ts";

test("오전 글은 전일 한국장과 간밤 미국장을 오늘 한국장 전망의 근거로 조회한다", () => {
  const queries = buildReferenceQueries({
    contentType: "KOREA_DAILY_PREVIEW",
    channel: "blog",
    market: "KR",
    topic: "오늘 코스피 전망",
    title: "오늘 코스피 전망: 간밤 미국장·금리·환율 영향",
  });

  assert.ok(queries.includes("전일 한국 증시 마감 요약"));
  assert.ok(queries.includes("전일 미국 증시 마감"));
  assert.ok(queries.includes("오늘 한국 증시 전망"));
});

test("17시 글은 전일 미국장과 오늘 미국장 전망을 우선하고 한국장은 연결 신호로 조회한다", () => {
  const queries = buildReferenceQueries({
    contentType: "KOREA_MARKET_CLOSE_US_PREVIEW",
    channel: "blog",
    market: "GLOBAL",
    topic: "오늘 미국장 전망",
    title: "오늘 미국장 전망: 나스닥·미국 금리·주요 일정",
  });

  assert.equal(queries[0], "전일 미국 증시 마감 나스닥 S&P500 다우");
  assert.ok(queries.includes("오늘 미국 증시 전망 나스닥 S&P500"));
  assert.ok(queries.includes("오늘 한국 증시 마감 미국장 연결 신호"));
});

test("토요일은 이번 주 복기 자료만, 일요일은 다음 주 전망 자료만 우선 조회한다", () => {
  const saturday = buildReferenceQueries({
    contentType: "WEEKLY_MARKET_REVIEW",
    channel: "blog",
    market: "GLOBAL",
    topic: "이번 주 한국·미국 시장 복기",
    title: "이번 주 증시 정리: 코스피·나스닥·주도 업종",
  });
  const sunday = buildReferenceQueries({
    contentType: "NEXT_WEEK_MARKET_PREVIEW",
    channel: "blog",
    market: "GLOBAL",
    topic: "다음 주 한국·미국 증시 전망",
    title: "다음 주 증시를 움직일 일정과 핵심 변수",
  });

  assert.ok(saturday.includes("이번 주 한국 미국 증시 정리"));
  assert.ok(saturday.includes("이번 주 미국 증시 S&P500 나스닥"));
  assert.equal(saturday.some((query) => query.includes("다음 주")), false);
  assert.ok(sunday.every((query) => query.includes("다음 주")));
});

test("투자 공부와 대형주 공시·실적은 각자의 검색 의도로 자료를 조회한다", () => {
  const study = buildReferenceQueries({
    contentType: "INVESTMENT_STUDY",
    channel: "blog",
    market: "GLOBAL",
    topic: "PER 계산법과 업종별 비교",
    title: "PER이 낮다고 항상 싼 주식은 아닌 이유",
  });
  const disclosure = buildReferenceQueries({
    contentType: "LARGE_CAP_DISCLOSURE_EARNINGS",
    channel: "blog",
    market: "GLOBAL",
    topic: "삼성전자 공식 실적 발표",
    title: "삼성전자 실적 발표 핵심 숫자",
  });
  assert.ok(study.some((query) => query.includes("CPI PPI FOMC 고용지표 발표시간")));
  assert.ok(study.some((query) => query.includes("오늘 코스피 나스닥")));
  assert.ok(study.some((query) => query.includes("실적 발표 뒤 주가 하락 이유")));
  assert.ok(disclosure.some((query) => query.includes("DART")));
  assert.ok(disclosure.some((query) => query.includes("SEC")));
});

test("선정된 실적 주제는 일반 투자공부 검색보다 회사·종목 검색을 먼저 실행한다", () => {
  const queries = buildReferenceQueries({
    contentType: "INVESTMENT_STUDY",
    channel: "blog",
    market: "GLOBAL",
    topic: "엔비디아 공식 실적과 국내 반도체주 영향",
    title: "엔비디아 실적 발표, 시간외 주가는 왜 올랐을까",
    keywords: ["엔비디아 실적 발표", "엔비디아 시간외 주가", "삼성전자", "SK하이닉스"],
    prioritizeInputQueries: true,
  });

  assert.equal(queries[0], "엔비디아 실적 발표, 시간외 주가는 왜 올랐을까");
  assert.equal(queries[1], "엔비디아 실적 발표 엔비디아 시간외 주가");
  assert.equal(queries[2], "엔비디아 실적 발표 삼성전자 SK하이닉스");
  assert.ok(queries.indexOf("이번 주 미국 CPI PPI FOMC 고용지표 발표시간") > 2);
});
