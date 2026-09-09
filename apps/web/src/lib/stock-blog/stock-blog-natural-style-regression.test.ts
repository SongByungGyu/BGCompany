import test from "node:test";
import assert from "node:assert/strict";
import { inspectNaturalStockBlogLayout } from "./stock-blog-natural-style.ts";
import { inspectStockBlogEditorialContract } from "./stock-blog-editorial-policy.ts";
import { assessStockBlogEditorialQuality, inspectOwnStockBlogStructure } from "./stock-blog-editorial-benchmark.ts";

// Minimal approved excerpts, not a copy of the private draft.
const morningExcerpts = [
  "오늘 코스피는 미국장 약세보다 환율과 수급 반응이 더 중요합니다. 장 초반에는 전일 약세를 바로 추세로 단정하기보다 환율이 더 흔들리는지부터 보시는 편이 낫습니다.",
  "전일 한국장이 남긴 수급 신호",
  "외국인 매수 기조가 이어지면 지수 하단이 바로 깨질 가능성은 줄어들고, 반대로 환율이 다시 튀면 전일 수급이 쉽게 약해질 수 있습니다.",
  "장 초반에 살필 변동 요인",
  "전일 코스피 수급이 완전히 무너진 것은 아니었기 때문에, 장 초반에는 환율이 더 안정되는지와 외국인 선물이 받쳐 주는지를 함께 보셔야 합니다.",
].join("\n\n");

test("9월 9일 원고의 보시는 편·보셔야·더 중요합니다를 정상 인식한다", () => {
  const result = inspectNaturalStockBlogLayout(morningExcerpts);
  assert.ok(result.observationSentenceCount >= 2);
  assert.equal(result.hasJudgment, true);
  assert.ok(result.observationEvidence.some(line => line.includes("보셔야")));
  assert.ok(result.judgmentEvidence.some(line => line.includes("더 중요합니다")));
  const contract = inspectStockBlogEditorialContract(morningExcerpts, "KOREA_DAILY_PREVIEW");
  assert.equal(contract.hasBgMarketNoteJudgment, true);
  assert.deepEqual(contract.violations, []);
});

test("판단·확인이라는 단어가 없어도 관건과 살필 자료를 인식한다", () => {
  const result = inspectNaturalStockBlogLayout("반등의 관건은 상승 종목 수의 확산입니다.\n\n살필 대목은 업종별 상승 종목 수와 거래대금의 동반 증가입니다.");
  assert.equal(result.hasJudgment, true);
  assert.equal(result.observationSentenceCount, 1);
});

test("이어지면·오르면·꺾이면도 조건으로 읽되 화면·국면은 제외한다", () => {
  const result = inspectNaturalStockBlogLayout("외국인 매수가 이어지면 지수 하단 부담이 줄어듭니다. 금리가 오르면 성장주 부담이 커집니다. 선물 매수가 꺾이면 환율을 다시 살펴야 합니다.");
  assert.equal(result.conditionalSentenceCount, 3);
  assert.equal(inspectNaturalStockBlogLayout("시장의 한 국면, 차트의 한 장면, 지수의 한 측면.").conditionalSentenceCount, 0);
});

test("판단·확인 단어만 늘어놓거나 숫자만 쓰면 통과 근거가 아니다", () => {
  for (const body of ["판단합니다. 확인하세요. 비교하겠습니다.", "코스피는 0.58% 내렸습니다. 환율은 1342원입니다."]) {
    const result = inspectNaturalStockBlogLayout(body);
    assert.equal(result.hasJudgment, false);
    assert.equal(result.observationSentenceCount, 0);
  }
});

test("기사 제목·자료 범위 고지·소제목을 본문 판단의 근거로 세지 않는다", () => {
  const result = inspectNaturalStockBlogLayout("코스피 지수는 하락했습니다.\n\n환율 판단과 수급 확인\n\n미국 금리와 경제지표는 확인 가능한 최신 공식 수치만 반영했습니다.\n\n함께 확인한 기사\n\n1. 환율 판단과 수급 확인 기사\nhttps://example.com");
  assert.equal(result.hasJudgment, false);
  assert.equal(result.observationSentenceCount, 0);
});

test("자연형 검사 실패를 옛 고정 제목·정확히 3개 요구로 설명하지 않는다", () => {
  const body = "코스피는 0.58% 내렸습니다.\n\n전일 시장의 수치 변화\n\n환율은 1342원입니다.\n\n미국 시장의 수치 변화\n\n미국 금리는 4.78%입니다.";
  const assessment = assessStockBlogEditorialQuality({structure: inspectOwnStockBlogStructure({title:"검토용", body, contentType:"KOREA_DAILY_PREVIEW", imageCount:3}), contentType:"KOREA_DAILY_PREVIEW", realReferenceCount:5,publisherCount:3,verifiedMarketSnapshot:true,qaScore:94});
  assert.equal(assessment.passed, false);
  assert.ok(assessment.failedChecks.some(check => check.includes("QA 95")));
  assert.ok(assessment.failedChecks.some(check => check.includes("자료에 근거한")));
  assert.ok(assessment.failedChecks.every(check => !/정확히 3개|BG Market Note 판단/.test(check)));
});
