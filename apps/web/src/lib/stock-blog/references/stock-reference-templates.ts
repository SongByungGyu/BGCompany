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
    label: "한국 마감·미국 장전 브리핑",
    market: "GLOBAL",
    minimumRealReferences: 3,
    minimumDistinctUrls: 3,
    minimumPublishers: 2,
    requiresMarketData: true,
    requirements: [
      { id: "kr-close", label: "금일 KOSPI/KOSDAQ 마감 흐름", sourceTypes: ["market_data"], markets: ["KR"], keywords: ["KOSPI", "KOSDAQ", "마감"] },
      { id: "kr-flow-sector", label: "수급/섹터/특징주", sourceTypes: ["market_data", "sector", "news", "company"], markets: ["KR"], keywords: ["외국인", "기관", "섹터", "특징주"] },
      { id: "us-preview", label: "미국장 체크포인트", sourceTypes: ["calendar", "macro", "news"], markets: ["US", "GLOBAL"], keywords: ["미국장", "금리", "실적", "경제지표"] },
    ],
  },
  WEEKLY_MARKET_REVIEW: {
    contentType: "WEEKLY_MARKET_REVIEW",
    label: "주간 시장 리뷰",
    market: "KR",
    minimumRealReferences: 3,
    minimumDistinctUrls: 3,
    minimumPublishers: 2,
    requiresMarketData: true,
    requirements: [
      { id: "weekly-index", label: "주간 KOSPI/KOSDAQ 흐름", sourceTypes: ["market_data"], markets: ["KR"], keywords: ["주간", "KOSPI", "KOSDAQ"] },
      { id: "weekly-sector-flow", label: "주간 섹터/수급", sourceTypes: ["sector", "market_data"], markets: ["KR"], keywords: ["섹터", "외국인", "기관"] },
      { id: "next-week-risk", label: "다음 주 체크포인트", sourceTypes: ["calendar", "macro", "news"], markets: ["KR", "GLOBAL"], keywords: ["다음 주", "경제 일정", "환율", "금리"] },
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
      { id: "last-week-global", label: "지난주 한국/미국 증시 요약", sourceTypes: ["market_data", "news"], markets: ["KR", "US", "GLOBAL"], keywords: ["지난주", "한국 증시", "미국 증시"] },
      { id: "next-week-calendar", label: "다음 주 주요 경제 일정", sourceTypes: ["calendar", "macro"], markets: ["GLOBAL", "US", "KR"], keywords: ["경제 일정", "실적", "FOMC", "물가"] },
      { id: "investor-checklist", label: "투자자 체크리스트", sourceTypes: ["macro", "sector", "news"], markets: ["GLOBAL", "KR", "US"], keywords: ["환율", "금리", "섹터", "리스크"] },
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
