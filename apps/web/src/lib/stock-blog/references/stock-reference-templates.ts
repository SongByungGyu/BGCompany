import type { ReferenceSourceType, StockReferenceBriefingTemplate } from "./reference-types";

export type StockReferenceRequirement = {
  id: string;
  label: string;
  sourceTypes: ReferenceSourceType[];
  markets: Array<"KR" | "US" | "GLOBAL">;
  keywords: string[];
};

export type StockReferenceTemplate = {
  contentType: StockReferenceBriefingTemplate;
  label: string;
  market: "KR" | "US" | "GLOBAL";
  minimumRealReferences: number;
  minimumDistinctUrls: number;
  minimumPublishers: number;
  requiresMarketData: boolean;
  requirements: StockReferenceRequirement[];
};

export const STOCK_REFERENCE_TEMPLATES: Record<StockReferenceBriefingTemplate, StockReferenceTemplate> = {
  KOREA_DAILY_PREVIEW: {
    contentType: "KOREA_DAILY_PREVIEW",
    label: "한국 증시 장전 브리핑",
    market: "KR",
    minimumRealReferences: 3,
    minimumDistinctUrls: 3,
    minimumPublishers: 2,
    requiresMarketData: true,
    requirements: [
      { id: "kr-previous-close", label: "전일 KOSPI/KOSDAQ 흐름", sourceTypes: ["market_data"], markets: ["KR"], keywords: ["KOSPI", "KOSDAQ", "전일 마감"] },
      { id: "us-overnight", label: "전일 미국 주요 지수 흐름", sourceTypes: ["market_data", "news"], markets: ["US", "GLOBAL"], keywords: ["S&P500", "Nasdaq", "Dow"] },
      { id: "fx-sector-events", label: "환율/섹터/금일 이벤트", sourceTypes: ["macro", "sector", "calendar", "news"], markets: ["KR", "GLOBAL"], keywords: ["환율", "섹터", "경제 일정"] },
    ],
  },
  KOREA_MARKET_CLOSE_US_PREVIEW: {
    contentType: "KOREA_MARKET_CLOSE_US_PREVIEW",
    label: "전일 미국장 리뷰·오늘 미국장 전망",
    market: "US",
    minimumRealReferences: 3,
    minimumDistinctUrls: 3,
    minimumPublishers: 2,
    requiresMarketData: true,
    requirements: [
      { id: "us-previous-close", label: "전일 S&P500/Nasdaq/Dow 마감 흐름", sourceTypes: ["market_data", "news"], markets: ["US", "GLOBAL"], keywords: ["S&P500", "Nasdaq", "Dow", "전일 마감"] },
      { id: "us-preview", label: "오늘 미국장 금리/달러/일정", sourceTypes: ["calendar", "macro", "news", "company"], markets: ["US", "GLOBAL"], keywords: ["미국장", "국채금리", "달러", "실적", "경제지표"] },
      { id: "kr-handoff", label: "오늘 한국장의 미국장 연결 신호", sourceTypes: ["market_data", "sector", "news"], markets: ["KR", "GLOBAL"], keywords: ["KOSPI", "환율", "반도체", "연결 신호"] },
    ],
  },
  WEEKLY_MARKET_REVIEW: {
    contentType: "WEEKLY_MARKET_REVIEW",
    label: "이번 주 한국·미국 시장 복기",
    market: "GLOBAL",
    minimumRealReferences: 3,
    minimumDistinctUrls: 3,
    minimumPublishers: 2,
    requiresMarketData: true,
    requirements: [
      { id: "weekly-global-index", label: "주간 KOSPI/KOSDAQ/S&P500/Nasdaq 흐름", sourceTypes: ["market_data", "news"], markets: ["KR", "US", "GLOBAL"], keywords: ["KOSPI", "KOSDAQ", "S&P500", "Nasdaq", "주간"] },
      { id: "weekly-sector-flow", label: "이번 주 수급/주도 업종", sourceTypes: ["sector", "market_data", "news"], markets: ["KR", "US", "GLOBAL"], keywords: ["외국인", "기관", "섹터", "주도 업종"] },
      { id: "weekly-drivers", label: "이번 주 금리/환율/주요 이벤트", sourceTypes: ["macro", "calendar", "news"], markets: ["KR", "US", "GLOBAL"], keywords: ["이번 주", "환율", "국채금리", "경제지표"] },
    ],
  },
  NEXT_WEEK_MARKET_PREVIEW: {
    contentType: "NEXT_WEEK_MARKET_PREVIEW",
    label: "다음 주 시장 프리뷰",
    market: "GLOBAL",
    minimumRealReferences: 3,
    minimumDistinctUrls: 3,
    minimumPublishers: 2,
    requiresMarketData: true,
    requirements: [
      { id: "last-week-global", label: "지난주 한국/미국 증시 짧은 요약", sourceTypes: ["market_data", "news"], markets: ["KR", "US", "GLOBAL"], keywords: ["지난주", "한국 증시", "미국 증시"] },
      { id: "next-week-calendar", label: "다음 주 주요 경제 일정", sourceTypes: ["calendar", "macro"], markets: ["GLOBAL", "US", "KR"], keywords: ["경제 일정", "실적", "FOMC", "물가"] },
      { id: "investor-checklist", label: "투자자 체크리스트", sourceTypes: ["macro", "sector", "news"], markets: ["GLOBAL", "KR", "US"], keywords: ["환율", "금리", "섹터", "리스크"] },
    ],
  },
  INVESTMENT_STUDY: {
    contentType: "INVESTMENT_STUDY",
    label: "토요일 투자 공부",
    market: "GLOBAL",
    minimumRealReferences: 3,
    minimumDistinctUrls: 3,
    minimumPublishers: 2,
    requiresMarketData: true,
    requirements: [
      { id: "study-definition", label: "개념 정의와 공식", sourceTypes: ["company", "macro", "news"], markets: ["GLOBAL", "KR", "US"], keywords: ["주식 공부", "재무제표", "투자 지표"] },
      { id: "study-example", label: "실제 시장·기업 사례", sourceTypes: ["market_data", "company", "news"], markets: ["GLOBAL", "KR", "US"], keywords: ["사례", "업종", "주가"] },
      { id: "study-caution", label: "해석 시 주의점", sourceTypes: ["news", "macro", "sector"], markets: ["GLOBAL", "KR", "US"], keywords: ["주의", "리스크", "해석"] },
    ],
  },
  LARGE_CAP_DISCLOSURE_EARNINGS: {
    contentType: "LARGE_CAP_DISCLOSURE_EARNINGS",
    label: "대형주 공시·실적 체크",
    market: "GLOBAL",
    minimumRealReferences: 3,
    minimumDistinctUrls: 3,
    minimumPublishers: 2,
    requiresMarketData: true,
    requirements: [
      { id: "official-release", label: "DART·SEC 공식 발표 원문", sourceTypes: ["disclosure"], markets: ["KR", "US"], keywords: ["공시", "10-Q", "10-K", "8-K", "실적"] },
      { id: "earnings-numbers", label: "실적 핵심 숫자와 비교 기준", sourceTypes: ["company", "disclosure", "news"], markets: ["KR", "US", "GLOBAL"], keywords: ["매출", "영업이익", "가이던스"] },
      { id: "market-impact", label: "주가·업종 영향", sourceTypes: ["market_data", "sector", "news"], markets: ["KR", "US", "GLOBAL"], keywords: ["주가", "업종", "시장 반응"] },
    ],
  },
};

export function getStockReferenceTemplate(contentType: StockReferenceBriefingTemplate) {
  return STOCK_REFERENCE_TEMPLATES[contentType];
}

export function getMissingReferenceRequirements(contentType: StockReferenceBriefingTemplate, matchedRequirementIds: string[]) {
  const matched = new Set(matchedRequirementIds);
  return getStockReferenceTemplate(contentType).requirements.filter((item) => !matched.has(item.id)).map((item) => item.label);
}
