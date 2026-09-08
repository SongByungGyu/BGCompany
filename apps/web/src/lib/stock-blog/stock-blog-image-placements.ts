import type { StockBriefingTemplate } from "@/features/content-pipeline/content-pipeline-types";
import { inspectNaturalStockBlogLayout } from "./stock-blog-natural-style.ts";

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
  body?: string,
): StockBlogImagePlacementHeadings {
  if (body) {
    const layout = inspectNaturalStockBlogLayout(body);
    if (layout.active && layout.headings.length >= 2) {
      const pick = (pattern: RegExp, fallback: number) => layout.headings.find(heading => pattern.test(heading))
        ?? layout.headings[Math.min(fallback, layout.headings.length - 1)];
      return {
        majorIndexChange: pick(/지수|코스피|코스닥|나스닥|종가|실적|숫자/, 0),
        kospiInvestorFlow: pick(/수급|외국인|기관|매수|매도|쏠림|사례/, 1),
        fxAndUsYields: pick(/금리|국채|환율|달러|유가|조건/, 2),
      };
    }
  }
  return EDITORIAL_PLACEMENTS[template];
}
