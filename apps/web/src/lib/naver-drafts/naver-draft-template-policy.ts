import type { StockBriefingTemplate } from "@/features/content-pipeline/content-pipeline-types";

export function shouldRejectDailyBriefingLanguage(template: StockBriefingTemplate) {
  return template === "WEEKLY_MARKET_REVIEW" || template === "NEXT_WEEK_MARKET_PREVIEW";
}
