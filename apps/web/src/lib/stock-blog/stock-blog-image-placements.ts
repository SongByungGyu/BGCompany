import type { StockBriefingTemplate } from "@/features/content-pipeline/content-pipeline-types";

export type StockBlogImagePlacementHeadings = {
  majorIndexChange: string;
  kospiInvestorFlow: string;
  fxAndUsYields: string;
};

const EDITORIAL_PLACEMENTS: Record<StockBriefingTemplate, StockBlogImagePlacementHeadings> = {
  KOREA_DAILY_PREVIEW: {
    majorIndexChange: "2. 오늘 시장 핵심 숫자",
    kospiInvestorFlow: "3. 오늘의 핵심 변수 2가지",
    fxAndUsYields: "4. 상승·하락 조건별 시나리오",
  },
  KOREA_MARKET_CLOSE_US_PREVIEW: {
    majorIndexChange: "2. 오늘 한국장 핵심 숫자",
    kospiInvestorFlow: "3. 오늘 밤 핵심 변수 2가지",
    fxAndUsYields: "4. 미국장 상승·하락 조건",
  },
  WEEKLY_MARKET_REVIEW: {
    majorIndexChange: "2. 이번 주 시장 핵심 숫자",
    kospiInvestorFlow: "3. 다음 주 핵심 변수 2가지",
    fxAndUsYields: "5. 다음 주 상승·하락 조건",
  },
  NEXT_WEEK_MARKET_PREVIEW: {
    majorIndexChange: "2. 지난주 시장 핵심 숫자",
    kospiInvestorFlow: "3. 다음 주 핵심 변수 2가지",
    fxAndUsYields: "5. 다음 주 상승·하락 조건",
  },
};

export function getStockBlogImagePlacementHeadings(
  template: StockBriefingTemplate,
): StockBlogImagePlacementHeadings {
  return EDITORIAL_PLACEMENTS[template];
}
