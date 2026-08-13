import type { ReferenceSearchInput, StockReferenceBriefingTemplate } from "./reference-types";

const templateQueries: Record<StockReferenceBriefingTemplate, string[]> = {
  KOREA_DAILY_PREVIEW: [
    "오늘 한국 증시 전망",
    "전일 한국 증시 마감 요약",
    "전일 미국 증시 마감",
    "코스피 코스닥 장전 체크포인트",
    "원달러 환율 금리 외국인 수급 한국 증시",
  ],
  KOREA_MARKET_CLOSE_US_PREVIEW: [
    "전일 미국 증시 마감 나스닥 S&P500 다우",
    "오늘 미국 증시 전망 나스닥 S&P500",
    "미국 선물 국채금리 달러",
    "오늘 미국 경제 일정 기업 실적",
    "오늘 한국 증시 마감 미국장 연결 신호",
  ],
  WEEKLY_MARKET_REVIEW: [
    "이번 주 한국 미국 증시 정리",
    "주간 코스피 코스닥 섹터 수급",
    "이번 주 미국 증시 S&P500 나스닥",
    "이번 주 외국인 기관 수급 주도 업종",
    "이번 주 원달러 환율 미국 국채금리 경제지표",
    "이번 주 강세 약세 업종 주요 경제 뉴스",
  ],
  NEXT_WEEK_MARKET_PREVIEW: [
    "다음 주 증시 주요 이슈 영향 섹터",
    "다음 주 한국 증시 전망 코스피 외국인 환율",
    "다음 주 미국 증시 실적 경제 일정 국채금리",
    "다음 주 수혜 업종 주의 섹터",
    "S&P500 나스닥 다음 주 실적 전망",
  ],
  INVESTMENT_STUDY: [
    "오늘 코스피 나스닥 급등 급락 이유",
    "오늘 주식시장 핵심 이슈 투자 원리",
    "금리 환율 물가 실적 주가 영향",
    "반도체 외국인 수급 투자 공부",
    "주식 투자 공부 재무제표 실제 사례",
  ],
  LARGE_CAP_DISCLOSURE_EARNINGS: [
    "대형주 실적 발표 공시 분석",
    "DART 주요경영사항 실적 공시",
    "SEC 10-Q 10-K 8-K earnings",
    "기업 실적 매출 영업이익 가이던스",
    "실적 발표 주가 업종 영향",
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
