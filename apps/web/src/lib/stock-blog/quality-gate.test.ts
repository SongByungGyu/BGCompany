import test from "node:test";
import assert from "node:assert/strict";
import {
  hasValidStockBlogBodyLength,
  inspectNextWeekEditorialContract,
  inspectStockBlogImagePublishReadiness,
  inspectStockBlogQaApproval,
} from "./quality-gate";
import type { ContentPipelineRun } from "@/features/content-pipeline/content-pipeline-types";

const disclaimer = "본 글은 시장 정보를 정리한 투자 참고 자료이며, 특정 종목의 매수 또는 매도를 권유하지 않습니다. 최종 투자 판단과 책임은 투자자 본인에게 있습니다.";

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
