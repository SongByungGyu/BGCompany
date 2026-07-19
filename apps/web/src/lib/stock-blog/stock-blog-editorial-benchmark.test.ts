import test from "node:test";
import assert from "node:assert/strict";
import {
  assessStockBlogEditorialQuality,
  buildStockBlogEditorialBenchmark,
  inspectOwnStockBlogStructure,
  selectSafeEditorialBenchmarkGuidelines,
  STOCK_BLOG_EDITORIAL_QUALITY_TARGET,
} from "./stock-blog-editorial-benchmark";

const intro = "최근 시장을 보면 지수의 방향보다 하루 사이의 변동성이 더 크게 느껴집니다. 국내 수급과 미국 국채금리 흐름이 엇갈리면서 투자자들도 한쪽 방향을 단정하기 어려운 모습이었습니다.";
const paragraph = "시장 흐름을 해석할 때는 지수 숫자 하나보다 수급과 환율, 금리의 연결을 함께 봐야 합니다. 확인된 자료를 기준으로 조건과 위험을 나누면 다음 거래일에 점검할 항목도 조금 더 분명해질 수 있습니다.";
const headings = [
  "1. 지난주 시장은 어땠을까",
  "2. 다음 주 한국 증시 전망",
  "3. 다음 주 미국 증시 전망",
  "4. 다음 주 핵심 일정",
  "5. 이번 주에 눈여겨볼 기회와 위험",
  "6. 개인 투자자가 확인할 것",
];
const checklist = [
  "- 실적 발표를 앞둔 종목 비중을 확인합니다.",
  "- 환율 상승에 민감한 종목을 점검합니다.",
  "- 최근 급등한 종목의 추격 매수를 피합니다.",
  "- 현금 비중과 레버리지 수준을 확인합니다.",
  "- 주요 일정 전 과도한 포지션을 줄입니다.",
].join("\n");
const body = [
  intro,
  ...headings.flatMap((heading) => [heading, paragraph, paragraph]),
  checklist,
  "함께 확인한 기사",
  "실제로 활용한 기사 세 건의 제목, 언론사, 발행일과 원문 링크를 이 부분에서만 제공합니다.",
  "마무리",
  paragraph,
  "본 글은 시장 정보를 정리한 투자 참고 자료이며, 특정 종목의 매수 또는 매도를 권유하지 않습니다. 최종 투자 판단과 책임은 투자자 본인에게 있습니다.",
].join("\n\n");

test("9/10 편집 기준을 충족한 자사 글 구조를 통과시킨다", () => {
  const structure = inspectOwnStockBlogStructure({
    title: "2026년 7월 20~24일 한국·미국 증시 전망｜환율과 국채금리 체크",
    body,
    imageCount: 4,
  });
  const quality = assessStockBlogEditorialQuality({
    structure,
    realReferenceCount: 5,
    publisherCount: 3,
    verifiedMarketSnapshot: true,
    qaScore: 93,
  });

  assert.equal(quality.target, STOCK_BLOG_EDITORIAL_QUALITY_TARGET);
  assert.equal(quality.passed, true);
  assert.ok(quality.score >= 90);
});

test("QA 90점 미만인 글은 다른 구조가 좋아도 차단한다", () => {
  const structure = inspectOwnStockBlogStructure({ title: "2026년 7월 증시 전망", body, imageCount: 4 });
  const quality = assessStockBlogEditorialQuality({
    structure,
    realReferenceCount: 6,
    publisherCount: 4,
    verifiedMarketSnapshot: true,
    qaScore: 89,
  });

  assert.equal(quality.passed, false);
  assert.ok(quality.failedChecks.some((item) => item.includes("Hermes QA 90점")));
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
    contentType: "NEXT_WEEK_MARKET_PREVIEW",
    title: "2026년 7월 20~24일 한국·미국 증시 전망｜환율과 국채금리 체크",
    body,
    imageCount: 4,
    realReferenceCount: 5,
    publisherCount: 3,
    verifiedMarketSnapshot: true,
    qaScore: 93,
    competitorAnalysis,
    appliedGuidelines: guidelines,
  });

  assert.equal(benchmark.competitor.analyzedCount, 3);
  assert.equal(benchmark.quality.passed, true);
  assert.ok(benchmark.appliedGuidelines.every((item) => !item.includes("원문 전체")));
  assert.match(benchmark.copyrightPolicy, /저장·복사하지 않고/);
});
