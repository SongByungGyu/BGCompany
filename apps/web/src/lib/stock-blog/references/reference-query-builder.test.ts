import test from "node:test";
import assert from "node:assert/strict";
import { buildReferenceQueries } from "./reference-query-builder.ts";

test("오전 글은 전일 한국장과 간밤 미국장을 오늘 한국장 전망의 근거로 조회한다", () => {
  const queries = buildReferenceQueries({
    contentType: "KOREA_DAILY_PREVIEW",
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
    topic: "이번 주 한국·미국 시장 복기",
    title: "이번 주 증시 정리: 코스피·나스닥·주도 업종",
  });
  const sunday = buildReferenceQueries({
    contentType: "NEXT_WEEK_MARKET_PREVIEW",
    topic: "다음 주 한국·미국 증시 전망",
    title: "다음 주 증시를 움직일 일정과 핵심 변수",
  });

  assert.ok(saturday.includes("이번 주 한국 미국 증시 정리"));
  assert.ok(saturday.includes("이번 주 미국 증시 S&P500 나스닥"));
  assert.equal(saturday.some((query) => query.includes("다음 주")), false);
  assert.ok(sunday.every((query) => query.includes("다음 주")));
});
