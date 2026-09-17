import assert from "node:assert/strict";
import test from "node:test";
import { shouldRejectDailyBriefingLanguage } from "./naver-draft-template-policy.ts";

test("일일 브리핑 표현 차단은 주말·주간 전망에만 적용한다", () => {
  assert.equal(shouldRejectDailyBriefingLanguage("WEEKLY_MARKET_REVIEW"), true);
  assert.equal(shouldRejectDailyBriefingLanguage("NEXT_WEEK_MARKET_PREVIEW"), true);
  assert.equal(shouldRejectDailyBriefingLanguage("INVESTMENT_STUDY"), false);
  assert.equal(shouldRejectDailyBriefingLanguage("KOREA_DAILY_PREVIEW"), false);
  assert.equal(shouldRejectDailyBriefingLanguage("KOREA_MARKET_CLOSE_US_PREVIEW"), false);
});
