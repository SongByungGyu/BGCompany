import test from "node:test";
import assert from "node:assert/strict";
import {
  hasValidStockBlogBodyLength,
  evaluateStockBlogReferences,
  inspectNextWeekEditorialContract,
  inspectStockBlogImagePublishReadiness,
  inspectStockBlogQaApproval,
} from "./quality-gate";
import type { ReferenceBundle } from "./references/reference-types";
import type { ContentPipelineRun } from "@/features/content-pipeline/content-pipeline-types";

const disclaimer = "본 글은 시장 정보를 정리한 투자 참고 자료이며, 특정 종목의 매수 또는 매도를 권유하지 않습니다. 최종 투자 판단과 책임은 투자자 본인에게 있습니다.";

function referenceOnlyFallbackBundle(): ReferenceBundle {
  const items = Array.from({ length: 5 }, (_, index) => ({
    id: `news-${index}`,
    sourceType: "news" as const,
    provider: "naver-news",
    title: `주식 투자 개념 기사 ${index + 1}`,
    url: `https://news${index + 1}.example.com/article`,
    publisher: `언론사 ${(index % 3) + 1}`,
    publishedAt: "2026-09-08T00:00:00.000Z",
    summary: "시황 숫자를 추정하지 않고 투자자가 확인할 개념과 순서를 설명합니다.",
  }));
  return {
    provider: "naver-search",
    mode: "real",
    status: "ready",
    contentType: "INVESTMENT_STUDY",
    generatedAt: "2026-09-08T00:00:00.000Z",
    marketDate: "2026-09-08",
    market: "GLOBAL",
    queries: ["주식 투자 공부"],
    items,
    competitorBlogReferences: Array.from({ length: 3 }, (_, index) => ({
      title: `경쟁 글 ${index + 1}`,
      url: `https://blog${index + 1}.example.com/post`,
      blogName: `블로그 ${index + 1}`,
      publishedAt: "2026-09-08T00:00:00.000Z",
      keywords: ["주식 투자 공부"],
      observedStructure: [],
      differentiationPoint: "검증 기사 중심",
    })),
    evidencePolicy: "reference-only-study-fallback",
    keyThemes: [],
    repeatedKeywords: [],
    differentiationPoints: [],
    cautionNotes: [],
    sourcePolicy: "검증된 실제 기사만 사용하고 시황 수치는 제외합니다.",
  };
}

test("시장자료 지연 대체 투자공부는 검증 기사 조건을 충족하면 스냅샷 없이 통과한다", () => {
  const result = evaluateStockBlogReferences(referenceOnlyFallbackBundle(), true);
  assert.equal(result.ok, true);
  assert.equal(result.status, "passed");
});

test("일반 글은 같은 기사 묶음이라도 검증된 시장 스냅샷 없이는 차단한다", () => {
  const bundle = referenceOnlyFallbackBundle();
  bundle.evidencePolicy = "market-snapshot-required";
  const result = evaluateStockBlogReferences(bundle, true);
  assert.equal(result.ok, false);
  assert.ok(result.reasons.some((reason) => reason.includes("MarketSnapshot")));
});

test("주간 전망 글의 기사 링크 3개·섹션 순서·유의문구를 식별한다", () => {
  const body = [
    "1. 30초 요약",
    "판단과 조건을 요약합니다.",
    "2. 다음 주 주요 이슈와 핵심 숫자",
    "핵심 숫자를 정리합니다.",
    "3. 다음 주 핵심 변수 2가지",
    "변수 두 개를 정리합니다.",
    "4. 다음 주 핵심 일정",
    "* 7월 23일 목요일: 한국 GDP",
    "5. 다음 주 상승·하락 조건",
    "상승 조건과 하락 조건입니다.",
    "6. 다음 주 초보자 설명",
    "초보자 설명입니다.",
    "7. 다음 주 볼 것 3가지",
    "* 보유 비중을 확인합니다.",
    "8. BG Market Note 판단",
    "판단 기준입니다.",
    "마무리",
    "구체적인 변수를 다시 확인합니다.",
    "함께 확인한 기사",
    "1. 기사 하나 – 언론사, 2026-07-18",
    "https://news.example.com/1",
    "2. 기사 둘 – 언론사, 2026-07-18",
    "https://news.example.com/2",
    "3. 기사 셋 – 언론사, 2026-07-18",
    "https://news.example.com/3",
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

test("QA 점수 보정 흔적이 있으면 원점수와 무관하게 재검수를 요구한다", () => {
  const result = inspectStockBlogQaApproval({
    ok: true,
    qaScore: 95,
    originalQaScore: 93,
    publishReadiness: "ready",
    finalRecommendation: "approve",
    requiredRevisions: [],
    deterministicQaReconciliation: { originalQaScore: 93 },
  });

  assert.equal(result.ok, false);
  assert.equal(result.authoritativeQaScore, 93);
  assert.equal(result.legacyReconciliationDetected, true);
  assert.ok(result.reasons.some((reason) => reason.includes("원 판정 점수")));
  assert.ok(result.reasons.some((reason) => reason.includes("재검수")));
});

test("ready·approve라도 필수 수정사항이 남으면 QA 승인을 통과시키지 않는다", () => {
  const blocked = inspectStockBlogQaApproval({
    ok: true,
    qaScore: 98,
    publishReadiness: "ready",
    finalRecommendation: "approve",
    requiredRevisions: ["번역투 문장을 수정해야 합니다."],
  });
  const passed = inspectStockBlogQaApproval({
    ok: true,
    qaScore: 98,
    publishReadiness: "ready",
    finalRecommendation: "approve",
    requiredRevisions: [],
  });

  assert.equal(blocked.ok, false);
  assert.equal(blocked.requiredRevisionCount, 1);
  assert.equal(passed.ok, true);
});

test("QA requiredRevisions는 명시적인 빈 문자열 배열일 때만 수정 없음으로 인정한다", () => {
  const base = {
    ok: true,
    qaScore: 98,
    publishReadiness: "ready",
    finalRecommendation: "approve",
  };
  for (const requiredRevisions of [undefined, "없음", [123], [""]] as const) {
    const inspected = inspectStockBlogQaApproval({ ...base, requiredRevisions });
    assert.equal(inspected.ok, false);
    assert.ok(inspected.reasons.some((reason) => reason.includes("문자열 배열")));
  }
  assert.equal(inspectStockBlogQaApproval({ ...base, requiredRevisions: [] }).ok, true);
});

function imageReadyPipeline(): ContentPipelineRun {
  const image = (id: string, role: "thumbnail" | "body", type: "thumbnail" | "chart" | "related-image") => ({
    id,
    role,
    type,
    title: id,
    placementAfterHeading: role === "thumbnail" ? "__thumbnail__" : `${id} heading`,
    imageUrl: `/generated/${id}.svg`,
    caption: `${id} caption`,
    sourceLabel: "2026-09-04 | KIS",
    sourceName: "BG Market Note",
    licenseType: type === "chart" ? "generated-data-chart" as const : "generated" as const,
    collectedAt: "2026-09-04T00:00:00.000Z",
    usageAllowed: true,
    dataKeys: [],
    dataPoints: [],
    width: 1200,
    height: 675,
    fileFormat: "image/svg+xml" as const,
    uploadFormat: "image/png" as const,
    fileVerified: true,
  });
  return {
    imageStatus: "generated",
    thumbnailImageUrl: "/generated/thumbnail.svg",
    inlineImageUrls: ["/generated/chart.svg", "/generated/context.svg"],
    contentImages: [
      image("thumbnail", "thumbnail", "thumbnail"),
      image("chart", "body", "chart"),
      image("context", "body", "related-image"),
    ],
    imageQuality: {
      status: "passed",
      checkedAt: "2026-09-04T00:00:00.000Z",
      bodyImageCount: 2,
      chartImageCount: 1,
      relatedImageCount: 1,
      generatedImageCount: 3,
      externalImageCount: 0,
      checks: [],
      issues: [],
    },
  } as unknown as ContentPipelineRun;
}

test("공용 이미지 발행 검사는 정상 썸네일·본문 차트 세트를 통과시킨다", () => {
  assert.deepEqual(inspectStockBlogImagePublishReadiness(imageReadyPipeline()), []);
});

test("공식 일정처럼 숫자 차트가 없는 투자공부 글은 주제 일치 인포그래픽 3장을 허용한다", () => {
  const pipeline = imageReadyPipeline();
  const bodyImages = ["schedule", "path", "checklist"].map((id) => ({
    ...pipeline.contentImages![1],
    id,
    type: "related-image" as const,
    licenseType: "generated" as const,
    sourceUrl: "https://www.bls.gov/schedule/2026/09_sched_list.htm",
    relevanceTags: ["cpi"],
  }));
  pipeline.inlineImageUrls = bodyImages.map((image) => image.imageUrl);
  pipeline.contentImages = [pipeline.contentImages![0], ...bodyImages];
  pipeline.referenceBundle = {
    provider: "web", mode: "real", contentType: "INVESTMENT_STUDY", generatedAt: "2026-09-07", market: "US", queries: [], items: [{
      id: "bls", sourceType: "calendar", provider: "bls", title: "CPI schedule", url: "https://www.bls.gov/schedule/2026/09_sched_list.htm", reliability: "official",
      facts: [{ key: "cpi.release", label: "발표 시각", value: "21:30", asOf: "2026-09-07", sourceName: "BLS", sourceUrl: "https://www.bls.gov/schedule/2026/09_sched_list.htm" }],
    }], keyThemes: [], repeatedKeywords: [], differentiationPoints: [], cautionNotes: [], sourcePolicy: "official",
  };

  assert.deepEqual(inspectStockBlogImagePublishReadiness(pipeline), []);
});

test("공용 이미지 발행 검사는 빈 이미지와 검증되지 않은 배치를 생성 단계에서 차단한다", () => {
  const pipeline = imageReadyPipeline();
  pipeline.imageStatus = "failed";
  pipeline.thumbnailImageUrl = undefined;
  pipeline.inlineImageUrls = [];
  pipeline.imageQuality = { ...pipeline.imageQuality!, status: "blocked" };
  pipeline.contentImages = [];

  const reasons = inspectStockBlogImagePublishReadiness(pipeline);
  assert.ok(reasons.includes("imageStatus=generated 필요"));
  assert.ok(reasons.includes("thumbnailImageUrl 필요"));
  assert.ok(reasons.includes("inlineImageUrls 1개 이상 필요"));
  assert.ok(reasons.includes("imageQuality=passed 필요"));
  assert.ok(reasons.includes("본문 이미지 2~4장 필요"));
  assert.ok(reasons.includes("검증 수치 기반 본문 차트 1장 이상 필요"));
});
