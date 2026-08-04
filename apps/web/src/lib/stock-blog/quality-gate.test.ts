import test from "node:test";
import assert from "node:assert/strict";
import { hasValidStockBlogBodyLength, inspectNextWeekEditorialContract } from "./quality-gate";

const disclaimer = "본 글은 시장 정보를 정리한 투자 참고 자료이며, 특정 종목의 매수 또는 매도를 권유하지 않습니다. 최종 투자 판단과 책임은 투자자 본인에게 있습니다.";

test("주간 전망 글의 기사 링크 3개·섹션 순서·유의문구를 식별한다", () => {
  const body = [
    "1. 30초 요약",
    "판단과 조건을 요약합니다.",
    "2. 지난주 시장 핵심 숫자",
    "핵심 숫자를 정리합니다.",
    "3. 다음 주 핵심 변수 2가지",
    "변수 두 개를 정리합니다.",
    "4. 다음 주 핵심 일정",
    "* 7월 23일 목요일: 한국 GDP",
    "5. 다음 주 상승·하락 조건",
    "상승 조건과 하락 조건입니다.",
    "6. 이번 주 초보자 설명",
    "초보자 설명입니다.",
    "7. 다음 주 볼 것 3가지",
    "* 보유 비중을 확인합니다.",
    "8. BG Market Note 판단",
    "판단 기준입니다.",
    "함께 확인한 기사",
    "1. 기사 하나 – 언론사, 2026-07-18",
    "https://news.example.com/1",
    "2. 기사 둘 – 언론사, 2026-07-18",
    "https://news.example.com/2",
    "3. 기사 셋 – 언론사, 2026-07-18",
    "https://news.example.com/3",
    "마무리",
    "구체적인 변수를 다시 확인합니다.",
    disclaimer,
  ].join("\n\n");
  const result = inspectNextWeekEditorialContract(body);

  assert.equal(result.articleEntryCount, 3);
  assert.equal(result.articleUrlCount, 3);
  assert.equal(result.outsideArticleUrlCount, 0);
  assert.equal(result.disclaimerCount, 1);
  assert.deepEqual(result.missingOrOutOfOrderHeadings, []);
  assert.deepEqual(result.forbiddenTerms, []);
});

test("기사 섹션 밖 링크와 내부 용어를 차단 대상으로 식별한다", () => {
  const result = inspectNextWeekEditorialContract(`1. 30초 요약\nhttps://api.example.com/data\nasOf 기준\n함께 확인한 기사\n1. 기사 – 언론사, 발행일\nhttps://news.example.com/1\n마무리\n${disclaimer}`);

  assert.equal(result.outsideArticleUrlCount, 1);
  assert.ok(result.forbiddenTerms.length >= 1);
  assert.ok(result.missingOrOutOfOrderHeadings.length >= 1);
});

test("본문 분량은 공백 포함 글자 수로 판정한다", () => {
  assert.equal(hasValidStockBlogBodyLength("가 ".repeat(900)), true);
  assert.equal(hasValidStockBlogBodyLength("가".repeat(1799)), false);
  assert.equal(hasValidStockBlogBodyLength("가".repeat(2801)), false);
  assert.equal(hasValidStockBlogBodyLength("가".repeat(3000), "NEXT_WEEK_MARKET_PREVIEW"), true);
});
