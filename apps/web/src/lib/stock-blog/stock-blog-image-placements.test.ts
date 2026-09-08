import assert from "node:assert/strict";
import test from "node:test";
import type { StockBriefingTemplate } from "@/features/content-pipeline/content-pipeline-types";
import { getStockBlogImagePlacementHeadings } from "./stock-blog-image-placements.ts";

test("내용형 소제목으로 쓴 글은 실제 존재하는 제목에만 이미지를 연결한다", () => {
  const body = ["충분히 긴 도입 문장입니다. 시장 자료의 기준일을 구분해서 설명하고 오늘 흐름에서 무엇이 달라졌는지 비교합니다.", "코스피가 밀린 자리", "장중 고점과 종가를 비교합니다.", "외국인은 무엇을 샀을까", "순매수 합계의 의미를 설명합니다.", "유가와 국채금리가 만나는 지점", "두 수치를 확인합니다."].join("\n\n");
  assert.deepEqual(getStockBlogImagePlacementHeadings("KOREA_MARKET_CLOSE_US_PREVIEW", body), {
    majorIndexChange: "코스피가 밀린 자리",
    kospiInvestorFlow: "외국인은 무엇을 샀을까",
    fxAndUsYields: "유가와 국채금리가 만나는 지점",
  });
});

test("다음 주 전망 이미지를 숫자·변수·시나리오 섹션에 배치한다", () => {
  assert.deepEqual(getStockBlogImagePlacementHeadings("NEXT_WEEK_MARKET_PREVIEW"), {
    majorIndexChange: "2. 다음 주 주요 이슈와 핵심 숫자",
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

  for (const template of Object.keys(expected) as StockBriefingTemplate[]) {
    assert.deepEqual(getStockBlogImagePlacementHeadings(template), expected[template]);
  }
});
