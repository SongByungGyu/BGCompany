import test from "node:test";
import assert from "node:assert/strict";
import {
  assessStockBlogEditorialQuality,
  buildStockBlogEditorialBenchmark,
  inspectOwnStockBlogStructure,
  selectSafeEditorialBenchmarkGuidelines,
  STOCK_BLOG_EDITORIAL_QUALITY_TARGET,
} from "./stock-blog-editorial-benchmark";

const paragraph = "시장 흐름을 해석할 때는 지수 숫자 하나보다 수급과 환율, 금리의 연결을 함께 봐야 합니다. 확인된 자료를 기준으로 조건과 위험을 나누면 다음 거래일에 점검할 항목도 조금 더 분명해질 수 있습니다.";
const body = [
  "1. 30초 요약",
  [
    "- 판단: 수급과 환율이 엇갈리는 중립 구간입니다.",
    "- 상방 조건: 환율 안정과 외국인 순매수가 함께 나타나는 경우입니다.",
    "- 하방 조건: 미국 금리 상승과 외국인 매도가 겹치는 경우입니다.",
    "- 다음 확인: 오전 10시 외국인 현물·선물 수급을 확인합니다.",
  ].join("\n"),
  "2. 오늘 시장 핵심 숫자",
  [
    "- 코스피 2,800선: 대형주 심리의 기준입니다.",
    "- 원·달러 환율 1,360원: 외국인 수급 부담을 보여줍니다.",
    "- 미국 10년물 4.2%: 성장주 할인율과 연결됩니다.",
    "- 나스닥 0.4% 상승: 국내 기술주 심리에 영향을 줄 수 있습니다.",
  ].join("\n"),
  paragraph,
  "3. 오늘의 핵심 변수 2가지",
  "- 변수 1: 환율 안정 여부입니다.\n- 변수 2: 외국인 현물·선물 동반 순매수 여부입니다.",
  paragraph,
  "4. 상승·하락 조건별 시나리오",
  `상승 조건은 환율 안정과 외국인 순매수가 함께 나타나는 경우입니다. 하락 조건은 미국 금리 상승과 외국인 매도가 겹치는 경우입니다. ${paragraph}`,
  paragraph,
  "5. 오늘의 초보자 설명",
  "외국인 수급은 해외 투자자의 국내 주식 매매 흐름을 뜻합니다. 현물과 선물이 같은 방향이면 흐름의 힘이 더 분명할 수 있습니다. 다만 하루 수급만으로 중기 방향을 단정해서는 안 됩니다.",
  "6. 오늘 볼 것 3가지",
  "- 오전 9시 원·달러 환율 방향\n- 오전 10시 외국인 현물·선물 수급\n- 오후 2시 반도체 거래대금 유지 여부",
  "7. BG Market Note 판단",
  paragraph,
  paragraph,
  paragraph,
  paragraph,
  paragraph,
  paragraph,
  paragraph,
  "함께 확인한 기사",
  "실제로 활용한 기사 세 건의 제목, 언론사, 발행일과 원문 링크를 이 부분에서만 제공합니다.",
  "마무리",
  paragraph,
  "본 글은 시장 정보를 정리한 투자 참고 자료이며, 특정 종목의 매수 또는 매도를 권유하지 않습니다. 최종 투자 판단과 책임은 투자자 본인에게 있습니다.",
].join("\n\n");

test("9.5/10 편집 기준을 충족한 자사 글 구조를 통과시킨다", () => {
  const structure = inspectOwnStockBlogStructure({
    title: "2026년 7월 20~24일 한국·미국 증시 전망｜환율과 국채금리 체크",
    body,
    imageCount: 4,
    contentType: "KOREA_DAILY_PREVIEW",
  });
  const quality = assessStockBlogEditorialQuality({
    structure,
    contentType: "KOREA_DAILY_PREVIEW",
    realReferenceCount: 5,
    publisherCount: 3,
    verifiedMarketSnapshot: true,
    qaScore: 97,
  });

  assert.equal(quality.target, STOCK_BLOG_EDITORIAL_QUALITY_TARGET);
  assert.equal(quality.passed, true, JSON.stringify(quality));
  assert.ok(quality.score >= 95);
});

test("QA 95점 미만인 글은 다른 구조가 좋아도 차단한다", () => {
  const structure = inspectOwnStockBlogStructure({ title: "2026년 7월 증시 전망", body, imageCount: 4, contentType: "KOREA_DAILY_PREVIEW" });
  const quality = assessStockBlogEditorialQuality({
    structure,
    contentType: "KOREA_DAILY_PREVIEW",
    realReferenceCount: 6,
    publisherCount: 4,
    verifiedMarketSnapshot: true,
    qaScore: 94,
  });

  assert.equal(quality.passed, false);
  assert.ok(quality.failedChecks.some((item) => item.includes("Hermes QA 95점")));
});

test("경쟁 글 원문 대신 구조 차이와 안전 가이드만 누적한다", () => {
  const competitorAnalysis = {
    requestedCount: 5,
    analyzedCount: 3,
    failedCount: 0,
    averages: { titleLength: 30, bodyLength: 2300, introLength: 180, paragraphCount: 14, headingCount: 6, imageCount: 3, linkCount: 3 },
    commonPatterns: ["제목에 날짜를 포함하는 글이 절반 이상"],
    differentiationOpportunities: ["경쟁 글보다 명확한 실제 출처·원문 URL 섹션 제공"],
    recommendedStructure: [],
    copyrightPolicy: "경쟁 글의 본문 문장은 저장·복사하지 않고 구조 지표와 자체 요약만 사용합니다.",
  };
  const guidelines = selectSafeEditorialBenchmarkGuidelines(competitorAnalysis);
  const benchmark = buildStockBlogEditorialBenchmark({
    contentType: "KOREA_DAILY_PREVIEW",
    title: "2026년 7월 20~24일 한국·미국 증시 전망｜환율과 국채금리 체크",
    body,
    imageCount: 4,
    realReferenceCount: 5,
    publisherCount: 3,
    verifiedMarketSnapshot: true,
    qaScore: 97,
    competitorAnalysis,
    appliedGuidelines: guidelines,
  });

  assert.equal(benchmark.competitor.analyzedCount, 3);
  assert.equal(benchmark.quality.passed, true, JSON.stringify(benchmark.quality));
  assert.ok(benchmark.appliedGuidelines.every((item) => !item.includes("원문 전체")));
  assert.match(benchmark.copyrightPolicy, /저장·복사하지 않고/);
});
