import test from "node:test";
import assert from "node:assert/strict";
import type { ReferenceItem } from "./reference-types";
import {
  isCompleteNewsTitle,
  isRelevantNextWeekNews,
  selectCompleteNewsReferences,
  selectDiverseNextWeekNews,
} from "./naver-search-reference-adapter";

function item(title: string, publisher: string, summary: string): ReferenceItem {
  return {
    id: `${publisher}-${title}`,
    sourceType: "news",
    provider: "naver-search",
    title,
    publisher,
    sourceName: publisher,
    publishedAt: "2026-07-19T00:00:00.000Z",
    collectedAt: "2026-07-19T00:00:00.000Z",
    url: `https://${publisher}/${encodeURIComponent(title)}`,
    summary,
    reliability: "major_media",
  };
}

test("코인·금 시세·뉴스브리핑과 암호화폐 전문 발행처를 주간 증시 기사에서 제외한다", () => {
  const now = Date.parse("2026-07-19T12:00:00.000Z");
  assert.equal(isRelevantNextWeekNews(item("[뉴스브리핑] BONK 급등", "example.com", "다음 주 미국 증시와 금리 전망"), now), false);
  assert.equal(isRelevantNextWeekNews(item("다음 주 미 경제 지표와 실적 시즌", "tokenpost.kr", "미국 증시 전망"), now), false);
  assert.equal(isRelevantNextWeekNews(item("주간 금시세 전망", "example.com", "다음 주 증시와 금리"), now), false);
  assert.equal(isRelevantNextWeekNews(item("다음 주 코스피 전망", "economy.example.com", "외국인 수급과 원달러 환율을 점검한다"), now), true);
  const stale = item("다음 주 코스피 전망", "old.example.com", "외국인 수급과 환율 전망");
  stale.publishedAt = "2025-12-14T00:00:00.000Z";
  assert.equal(isRelevantNextWeekNews(stale, now), false);
});

test("관련 기사 선택 시 발행처를 먼저 다양하게 구성하고 부족할 때만 두 번째 기사를 허용한다", () => {
  const now = Date.parse("2026-07-19T12:00:00.000Z");
  const selected = selectDiverseNextWeekNews([
    item("다음 주 코스피 전망 A", "a.example.com", "외국인 수급과 환율 전망"),
    item("다음 주 코스피 전망 B", "a.example.com", "기관 수급과 금리 전망"),
    item("다음 주 나스닥 실적 전망", "b.example.com", "기업 실적 시즌과 국채금리"),
    item("다음 주 S&P500 전망", "c.example.com", "연준과 달러 흐름"),
  ], 3, now);

  assert.equal(selected.length, 3);
  assert.equal(new Set(selected.map((entry) => entry.publisher)).size, 3);
});

test("검색 결과 제목이 끝에서 잘린 경우만 불완전 제목으로 판정한다", () => {
  assert.equal(isCompleteNewsTitle("금리장인가...AI 투자심리가 변수"), true);
  assert.equal(isCompleteNewsTitle("환율 1,360원 아래로 [마켓..."), false);
  assert.equal(isCompleteNewsTitle("코스피 반등 가능성…"), false);
  assert.equal(isCompleteNewsTitle("코스피 반등 가능성 &hellip;"), false);
  assert.equal(isCompleteNewsTitle(""), false);
});

test("잘린 제목은 제외하고 뒤의 정상 기사로 채운다", () => {
  const references = [
    item("첫 기사...", "a.example.com", "코스피"),
    item("두 번째 기사…", "b.example.com", "환율"),
    item("세 번째 정상 기사", "c.example.com", "금리"),
    item("네 번째 정상 기사", "d.example.com", "나스닥"),
  ];
  const selected = selectCompleteNewsReferences(references, 2);
  assert.deepEqual(selected.map((entry) => entry.title), [
    "세 번째 정상 기사",
    "네 번째 정상 기사",
  ]);
});
