import test from "node:test";
import assert from "node:assert/strict";
import { getInvestmentStudySearchCampaign } from "./investment-study-search-campaign.ts";

const collectedAt = "2026-09-07T03:00:00.000Z";

test("9월 8일 화요일 검색 캠페인은 CPI 공식 일정 질문을 고정한다", () => {
  const campaign = getInvestmentStudySearchCampaign({
    marketDate: "2026-09-08",
    angle: "upcoming_question",
    collectedAt,
  });

  assert.match(campaign?.selection.title ?? "", /미국 CPI 발표시간/);
  assert.match(campaign?.selection.topic ?? "", /9월 11일/);
  assert.equal(campaign?.referenceItems[0]?.reliability, "official");
  assert.match(campaign?.referenceItems[0]?.url ?? "", /bls\.gov/);
});

test("9월 10일 목요일 검색 캠페인은 브로드컴 공식 실적을 고정한다", () => {
  const campaign = getInvestmentStudySearchCampaign({
    marketDate: "2026-09-10",
    angle: "result_or_practical",
    collectedAt,
  });

  assert.match(campaign?.selection.title ?? "", /브로드컴 실적 발표/);
  assert.equal(campaign?.selection.score, 5);
  assert.deepEqual(campaign?.referenceItems[0]?.symbols, ["AVGO"]);
  assert.equal(campaign?.referenceItems[0]?.metrics?.[0]?.value, 29.6);
});

test("다른 날짜와 편집 각도에는 일회성 캠페인을 적용하지 않는다", () => {
  assert.equal(getInvestmentStudySearchCampaign({ marketDate: "2026-09-09", angle: "upcoming_question", collectedAt }), null);
  assert.equal(getInvestmentStudySearchCampaign({ marketDate: "2026-09-08", angle: "result_or_practical", collectedAt }), null);
});
