import type { ReferenceSearchInput, StockReferenceBriefingTemplate } from "./reference-types";

const templateQueries: Record<StockReferenceBriefingTemplate, string[]> = {
  KOREA_DAILY_PREVIEW: [
    "오늘 한국 증시 전망",
    "전일 미국 증시 마감",
    "코스피 코스닥 장전 체크포인트",
    "원달러 환율 금리 외국인 수급 한국 증시",
    "반도체 자동차 2차전지 수급",
  ],
  KOREA_MARKET_CLOSE_US_PREVIEW: [
    "오늘 한국 증시 마감 정리",
    "외국인 기관 수급 코스피 코스닥",
    "오늘 강세 약세 업종",
    "오늘 미국 증시 전망 나스닥 S&P500",
    "미국 선물 국채금리 달러",
  ],
  WEEKLY_MARKET_REVIEW: [
    "이번 주 한국 증시 정리",
    "주간 코스피 코스닥 섹터 수급",
    "이번 주 미국 증시 S&P500 나스닥",
    "주간 외국인 기관 수급",
    "이번 주 강세 약세 업종 주요 경제 뉴스",
  ],
  NEXT_WEEK_MARKET_PREVIEW: [
    "다음 주 경제 일정",
    "다음 주 미국 경제지표",
    "다음 주 주요 실적 발표",
    "다음 주 한국 증시 전망",
    "다음 주 FOMC CPI 고용지표",
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
  ].map((query) => query.trim()).filter(Boolean))).slice(0, 6);
}
