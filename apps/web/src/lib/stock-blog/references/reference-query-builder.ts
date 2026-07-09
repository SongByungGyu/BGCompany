import type { ReferenceSearchInput, StockReferenceBriefingTemplate } from "./reference-types";

const templateQueries: Record<StockReferenceBriefingTemplate, string[]> = {
  KOREA_DAILY_PREVIEW: [
    "오늘 한국 증시 전망",
    "코스피 코스닥 장전 체크포인트",
    "원달러 환율 금리 외국인 수급 한국 증시",
  ],
  KOREA_MARKET_CLOSE_US_PREVIEW: [
    "오늘 한국 증시 마감 정리",
    "오늘 밤 미국 증시 전망 나스닥 S&P500",
    "한국 증시 섹터 흐름 미국장 체크포인트",
  ],
  WEEKLY_MARKET_REVIEW: [
    "이번 주 한국 증시 정리",
    "주간 코스피 코스닥 섹터 수급",
    "이번 주 환율 금리 반도체 이차전지 증시",
  ],
  NEXT_WEEK_MARKET_PREVIEW: [
    "다음 주 미국 증시 일정",
    "다음 주 FOMC CPI 고용 실적 발표 일정",
    "다음 주 한국 미국 증시 체크포인트",
  ],
};

export function buildReferenceQueries(input: ReferenceSearchInput): string[] {
  const base = templateQueries[input.contentType] ?? templateQueries.KOREA_DAILY_PREVIEW;
  const keywordQuery = (input.keywords ?? []).slice(0, 4).join(" ").trim();
  const topicQuery = [input.topic, input.title].filter(Boolean).join(" ");
  return Array.from(new Set([
    ...base,
    topicQuery,
    keywordQuery ? `${topicQuery} ${keywordQuery}` : topicQuery,
  ].map((query) => query.trim()).filter(Boolean)));
}
