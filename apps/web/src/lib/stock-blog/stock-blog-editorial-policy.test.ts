import test from "node:test";
import assert from "node:assert/strict";
import {
  getStockBlogEditorialGuidelines,
  getStockBlogEditorialPolicy,
  inspectStockBlogEditorialContract,
} from "./stock-blog-editorial-policy.ts";

const validBody = [
  "1. 30초 요약",
  "- 판단: 환율과 외국인 수급을 함께 확인할 구간입니다.",
  "- 상방 조건: 원·달러 환율이 안정되고 외국인 순매수가 이어지는 경우입니다.",
  "- 하방 조건: 미국 금리가 오르고 외국인 매도가 커지는 경우입니다.",
  "- 다음 확인: 오전 10시 외국인 현물·선물 수급을 확인합니다.",
  "2. 전일 한국장 코멘트와 간밤 미국장 핵심 숫자",
  "- 코스피 2,800선: 대형주 투자심리의 기준입니다.",
  "- 원·달러 환율 1,360원: 외국인 수급 부담을 가늠합니다.",
  "- 미국 10년물 4.2%: 성장주 할인율과 연결됩니다.",
  "- 나스닥 0.4% 상승: 국내 기술주 심리에 영향을 줄 수 있습니다.",
  "3. 오늘 한국장 핵심 변수 2가지",
  "- 변수 1: 환율 안정 여부입니다.",
  "- 변수 2: 외국인 현물·선물 동반 순매수 여부입니다.",
  "4. 한국장 상승·하락 조건",
  "상승 조건은 환율 안정과 외국인 순매수가 함께 나타나는 경우입니다. 하락 조건은 미국 금리 상승과 외국인 매도가 겹치는 경우입니다.",
  "5. 오늘의 초보자 설명",
  "외국인 수급은 해외 투자자의 국내 주식 매매 흐름을 뜻합니다. 현물과 선물이 같은 방향이면 흐름의 힘이 더 분명할 수 있습니다. 다만 하루 수급만으로 중기 방향을 단정해서는 안 됩니다.",
  "6. 오늘 한국장 볼 것 3가지",
  "- 오전 9시 원·달러 환율 방향",
  "- 오전 10시 외국인 현물·선물 수급",
  "- 오후 2시 반도체 거래대금 유지 여부",
  "7. BG Market Note 판단",
  "기본 판단은 중립입니다. 환율과 수급이 동시에 안정되면 상방 판단을 높이고, 두 지표가 함께 나빠지면 보수적으로 바꿉니다.",
  "함께 확인한 기사",
  "실제로 사용한 기사와 원문을 표시합니다.",
  "마무리",
  "방향보다 판단이 달라지는 조건을 먼저 확인하겠습니다.",
].join("\n\n");

test("일일·주간 템플릿에 서로 다른 분량과 고정 구조를 제공한다", () => {
  const daily = getStockBlogEditorialPolicy("KOREA_DAILY_PREVIEW");
  const weekly = getStockBlogEditorialPolicy("NEXT_WEEK_MARKET_PREVIEW");

  assert.deepEqual(daily.bodyLength, { min: 1800, targetMin: 2100, targetMax: 2600, max: 2800 });
  assert.deepEqual(weekly.bodyLength, { min: 2000, targetMin: 2300, targetMax: 2900, max: 3200 });
  assert.equal(daily.bodyStructure[0], "1. 30초 요약");
  assert.equal(daily.bodyStructure[1], "2. 전일 한국장 코멘트와 간밤 미국장 핵심 숫자");
  assert.equal(
    getStockBlogEditorialPolicy("KOREA_MARKET_CLOSE_US_PREVIEW").bodyStructure[1],
    "2. 전일 미국장 핵심 숫자와 오늘 연결 신호",
  );
  assert.ok(weekly.bodyStructure.includes("4. 다음 주 핵심 일정"));
  assert.match(getStockBlogEditorialGuidelines("KOREA_DAILY_PREVIEW").join("\n"), /댓글·공감·이웃·투표/);
  assert.match(getStockBlogEditorialGuidelines("KOREA_DAILY_PREVIEW").join("\n"), /전일 한국장 마감을 2~3문장/);
  assert.match(getStockBlogEditorialGuidelines("KOREA_MARKET_CLOSE_US_PREVIEW").join("\n"), /전일 S&P500·나스닥·다우/);
});

test("30초 요약·숫자·변수·시나리오·초보자 설명·확인 항목 계약을 검증한다", () => {
  const result = inspectStockBlogEditorialContract(validBody, "KOREA_DAILY_PREVIEW");

  assert.equal(result.hasThirtySecondSummary, true);
  assert.equal(result.coreNumberCount, 4);
  assert.equal(result.coreVariableCount, 2);
  assert.equal(result.hasConditionalScenarios, true);
  assert.equal(result.beginnerExplanationSentenceCount, 3);
  assert.equal(result.checklistItemCount, 3);
  assert.deepEqual(result.violations, []);
});

test("실제 생성기에서 사용한 번호 목록과 동의 표현을 올바르게 인식한다", () => {
  const generatedBody = validBody
    .replace("- 판단:", "- 기본 판단:")
    .replace("- 상방 조건:", "- 상승 조건:")
    .replace("- 하방 조건:", "- 하락 조건:")
    .replace("- 다음 확인:", "- 다음 확인 지표:")
    .replace("- 코스피 2,800선:", "1. 코스피 2,800선:")
    .replace("- 원·달러 환율 1,360원:", "2. 원·달러 환율 1,360원:")
    .replace("- 미국 10년물 4.2%:", "3. 미국 10년물 4.2%:")
    .replace("- 나스닥 0.4% 상승:", "4. 나스닥 0.4% 상승:")
    .replace("- 변수 1:", "- 변수 1은")
    .replace("- 변수 2:", "- 변수 2는")
    .replace("상승 조건은", "상방 조건은")
    .replace("하락 조건은", "하방 조건은")
    .replace("- 오전 9시 원·달러 환율 방향", "1) 오전 9시 원·달러 환율 방향")
    .replace("- 오전 10시 외국인 현물·선물 수급", "2) 오전 10시 외국인 현물·선물 수급")
    .replace("- 오후 2시 반도체 거래대금 유지 여부", "3) 오후 2시 반도체 거래대금 유지 여부");

  const result = inspectStockBlogEditorialContract(generatedBody, "KOREA_DAILY_PREVIEW");

  assert.equal(result.summaryLabelCount, 4);
  assert.equal(result.coreNumberCount, 4);
  assert.equal(result.coreVariableCount, 2);
  assert.equal(result.hasConditionalScenarios, true);
  assert.equal(result.checklistItemCount, 3);
  assert.deepEqual(result.violations, []);
});

test("AI 상투어·참여 CTA·과도한 빈 문단을 차단한다", () => {
  const result = inspectStockBlogEditorialContract(
    `${validBody}\n\n\n결론부터 말씀드리면 댓글로 의견을 남겨주세요.`,
    "KOREA_DAILY_PREVIEW",
  );

  assert.ok(result.forbiddenPhraseMatches.includes("결론부터 말씀드리면"));
  assert.equal(result.hasForbiddenEngagementCta, true);
  assert.equal(result.excessiveBlankLineRunCount, 1);
  assert.ok(result.violations.length >= 3);
});
