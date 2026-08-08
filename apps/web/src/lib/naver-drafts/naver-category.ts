import type { StockBriefingTemplate } from "@/features/content-pipeline/content-pipeline-types";

const DEFAULT_CATEGORY_BY_TEMPLATE: Record<StockBriefingTemplate, string> = {
  KOREA_DAILY_PREVIEW: "오늘의 한국장 전망",
  KOREA_MARKET_CLOSE_US_PREVIEW: "오늘의 미국장 전망",
  WEEKLY_MARKET_REVIEW: "주간 시장 정리",
  NEXT_WEEK_MARKET_PREVIEW: "주요 이슈/섹터",
  INVESTMENT_STUDY: "투자 공부",
  LARGE_CAP_DISCLOSURE_EARNINGS: "공시/실적 체크",
};

const NAVER_CATEGORY_LABELS = new Set([
  "주식 정보 공유",
  "오늘의 한국장 전망",
  "오늘의 미국장 전망",
  "주간 시장 정리",
  "차주 시장 전망",
  "주요 이슈/섹터",
  "공시/실적 체크",
  "투자 공부",
]);

export function resolveStockBriefingNaverCategory(
  template: StockBriefingTemplate,
  requestedCategory?: string | null,
) {
  const requested = requestedCategory?.replace(/\s+/g, " ").trim() ?? "";
  return NAVER_CATEGORY_LABELS.has(requested)
    ? requested
    : DEFAULT_CATEGORY_BY_TEMPLATE[template];
}
