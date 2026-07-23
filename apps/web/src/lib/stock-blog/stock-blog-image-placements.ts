import type { StockBriefingTemplate } from "@/features/content-pipeline/content-pipeline-types";

export type StockBlogImagePlacementHeadings = {
  majorIndexChange: string;
  kospiInvestorFlow: string;
  fxAndUsYields: string;
};

const STANDARD_EDITORIAL_PLACEMENTS: StockBlogImagePlacementHeadings = {
  majorIndexChange: "1. 최근 시장은 어땠을까",
  kospiInvestorFlow: "2. 한국 증시 흐름과 전망",
  fxAndUsYields: "3. 미국 증시와 글로벌 변수",
};

const NEXT_WEEK_PLACEMENTS: StockBlogImagePlacementHeadings = {
  majorIndexChange: "1. 지난주 시장은 어땠을까",
  kospiInvestorFlow: "2. 다음 주 한국 증시 전망",
  fxAndUsYields: "3. 다음 주 미국 증시 전망",
};

export function getStockBlogImagePlacementHeadings(
  template: StockBriefingTemplate,
): StockBlogImagePlacementHeadings {
  return template === "NEXT_WEEK_MARKET_PREVIEW"
    ? NEXT_WEEK_PLACEMENTS
    : STANDARD_EDITORIAL_PLACEMENTS;
}
