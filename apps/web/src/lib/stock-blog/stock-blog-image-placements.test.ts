import assert from "node:assert/strict";
import test from "node:test";
import type { StockBriefingTemplate } from "@/features/content-pipeline/content-pipeline-types";
import { getStockBlogImagePlacementHeadings } from "./stock-blog-image-placements";

test("uses next-week headings only for the next-week preview", () => {
  assert.deepEqual(getStockBlogImagePlacementHeadings("NEXT_WEEK_MARKET_PREVIEW"), {
    majorIndexChange: "1. 지난주 시장은 어땠을까",
    kospiInvestorFlow: "2. 다음 주 한국 증시 전망",
    fxAndUsYields: "3. 다음 주 미국 증시 전망",
  });
});

test("uses standard editorial headings for daily and weekly review templates", () => {
  const templates: StockBriefingTemplate[] = [
    "KOREA_DAILY_PREVIEW",
    "KOREA_MARKET_CLOSE_US_PREVIEW",
    "WEEKLY_MARKET_REVIEW",
  ];

  for (const template of templates) {
    assert.deepEqual(getStockBlogImagePlacementHeadings(template), {
      majorIndexChange: "1. 최근 시장은 어땠을까",
      kospiInvestorFlow: "2. 한국 증시 흐름과 전망",
      fxAndUsYields: "3. 미국 증시와 글로벌 변수",
    });
  }
});
