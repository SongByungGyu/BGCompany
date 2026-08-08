import type { StockBriefingTemplate } from "@/features/content-pipeline/content-pipeline-types";

export type StockBlogImagePlacementHeadings = {
  majorIndexChange: string;
  kospiInvestorFlow: string;
  fxAndUsYields: string;
};

const EDITORIAL_PLACEMENTS: Record<StockBriefingTemplate, StockBlogImagePlacementHeadings> = {
  KOREA_DAILY_PREVIEW: {
    majorIndexChange: "2. 전일 한국장 코멘트와 간밤 미국장 핵심 숫자",
    kospiInvestorFlow: "3. 오늘 한국장 핵심 변수 2가지",
    fxAndUsYields: "4. 한국장 상승·하락 조건",
  },
  KOREA_MARKET_CLOSE_US_PREVIEW: {
    majorIndexChange: "2. 전일 미국장 핵심 숫자와 오늘 연결 신호",
    kospiInvestorFlow: "3. 오늘 밤 미국장 핵심 변수 2가지",
    fxAndUsYields: "4. 미국장 상승·하락 조건",
  },
  WEEKLY_MARKET_REVIEW: {
    majorIndexChange: "2. 이번 주 한국·미국 시장 핵심 숫자",
    kospiInvestorFlow: "5. 이번 주 수급·주도 업종",
    fxAndUsYields: "3. 이번 주 핵심 변수 2가지",
  },
  NEXT_WEEK_MARKET_PREVIEW: {
    majorIndexChange: "2. 다음 주 주요 이슈와 핵심 숫자",
    kospiInvestorFlow: "3. 다음 주 핵심 변수 2가지",
    fxAndUsYields: "5. 다음 주 상승·하락 조건",
  },
  INVESTMENT_STUDY: {
    majorIndexChange: "2. 개념을 이해할 핵심 숫자",
    kospiInvestorFlow: "5. 실제 시장·기업 사례",
    fxAndUsYields: "4. 유리·불리해지는 상승·하락 조건",
  },
  LARGE_CAP_DISCLOSURE_EARNINGS: {
    majorIndexChange: "2. 공시·실적 핵심 숫자",
    kospiInvestorFlow: "5. 공식 발표와 시장 반응",
    fxAndUsYields: "4. 주가 상승·하락 조건",
  },
};

export function getStockBlogImagePlacementHeadings(
  template: StockBriefingTemplate,
): StockBlogImagePlacementHeadings {
  return EDITORIAL_PLACEMENTS[template];
}
