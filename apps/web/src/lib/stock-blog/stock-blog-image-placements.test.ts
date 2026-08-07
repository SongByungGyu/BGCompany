import assert from "node:assert/strict";
import test from "node:test";
import type { StockBriefingTemplate } from "@/features/content-pipeline/content-pipeline-types";
import { getStockBlogImagePlacementHeadings } from "./stock-blog-image-placements.ts";

test("다음 주 전망 이미지를 숫자·변수·시나리오 섹션에 배치한다", () => {
  assert.deepEqual(getStockBlogImagePlacementHeadings("NEXT_WEEK_MARKET_PREVIEW"), {
    majorIndexChange: "2. 지난주 시장 핵심 숫자",
    kospiInvestorFlow: "3. 다음 주 핵심 변수 2가지",
    fxAndUsYields: "5. 다음 주 상승·하락 조건",
  });
});

test("각 자동발행 템플릿의 실제 절 제목과 이미지 위치가 일치한다", () => {
  const expected: Record<StockBriefingTemplate, ReturnType<typeof getStockBlogImagePlacementHeadings>> = {
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

  for (const template of Object.keys(expected) as StockBriefingTemplate[]) {
    assert.deepEqual(getStockBlogImagePlacementHeadings(template), expected[template]);
  }
});
