import test from "node:test";
import assert from "node:assert/strict";
import type { ReferenceItem } from "./reference-types";
import { isRelevantNextWeekNews, selectDiverseNextWeekNews } from "./naver-search-reference-adapter";

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
  assert.equal(isRelevantNextWeekNews(item("[뉴스브리핑] BONK 급등", "example.com", "다음 주 미국 증시와 금리 전망")), false);
  assert.equal(isRelevantNextWeekNews(item("다음 주 미 경제 지표와 실적 시즌", "tokenpost.kr", "미국 증시 전망")), false);
  assert.equal(isRelevantNextWeekNews(item("주간 금시세 전망", "example.com", "다음 주 증시와 금리")), false);
  assert.equal(isRelevantNextWeekNews(item("다음 주 코스피 전망", "economy.example.com", "외국인 수급과 원달러 환율을 점검한다")), true);
});

test("관련 기사 선택 시 발행처를 먼저 다양하게 구성하고 부족할 때만 두 번째 기사를 허용한다", () => {
  const selected = selectDiverseNextWeekNews([
    item("다음 주 코스피 전망 A", "a.example.com", "외국인 수급과 환율 전망"),
    item("다음 주 코스피 전망 B", "a.example.com", "기관 수급과 금리 전망"),
    item("다음 주 나스닥 실적 전망", "b.example.com", "기업 실적 시즌과 국채금리"),
    item("다음 주 S&P500 전망", "c.example.com", "연준과 달러 흐름"),
  ], 3);

  assert.equal(selected.length, 3);
  assert.equal(new Set(selected.map((entry) => entry.publisher)).size, 3);
});
