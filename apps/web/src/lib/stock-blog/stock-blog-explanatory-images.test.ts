import test from "node:test";
import assert from "node:assert/strict";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import type { ContentPipelineRun } from "@/features/content-pipeline/content-pipeline-types";
import type { ReferenceBundle, MarketSnapshot } from "./references/reference-types";
import { planExplanatoryImages, isVerifiedExplanatoryImage } from "./stock-blog-explanatory-images";
import { generateStockBlogImages } from "./stock-blog-image-generator";
import { evaluateStockBlogImageQuality } from "./stock-blog-image-quality";
import { inspectStockBlogImagePublishReadiness, evaluateStockBlogReferences } from "./quality-gate";

const body = `수치를 확인하지 못한 항목은 제외하고 확인 방법을 정리합니다.

## 지수와 종목의 차이

코스피 지수와 종목별 거래대금을 비교합니다.

## 외국인 수급을 읽는 순서

외국인과 기관의 현물 수급은 기준 거래일을 구분해서 봅니다.

## 환율과 금리에서 확인할 것

환율과 국채금리의 기준 시각을 나누고 지수 반응을 비교합니다.
`;
const bundle: ReferenceBundle = {
  provider: "web", mode: "real", status: "ready", contentType: "INVESTMENT_STUDY", market: "KR",
  marketDate: "2026-09-09", generatedAt: "2026-09-09T00:00:00Z", queries: [], keyThemes: [], repeatedKeywords: [], differentiationPoints: [], cautionNotes: [], sourcePolicy: "official", missingItems: [],
  items: [{ id: "official-guide", sourceType: "manual", provider: "official", reliability: "official",
    title: "코스피 지수, 외국인 수급, 환율과 국채금리 확인 안내", url: "https://example.org/verified-guide", sourceName: "검증 테스트 자료",
    metrics: [{ key: "unrelated.metric", value: 10, label: "별도 수치", unit: "%", asOf: "2026-09-08", sourceName: "검증 테스트 자료" }] }],
};
const metric = (label: string, value: number, changePct?: number, unit = "%") => ({ label, value, changePct, unit, freshness: "fresh" as const, asOf: "2026-09-08", sourceName: "공식 테스트", url: "https://example.org/verified-data" });
const snapshot: MarketSnapshot = {
  provider: "kis-fred", status: "ready", dataQuality: "verified", fallbackUsed: false, marketDate: "2026-09-09", collectedAt: "2026-09-09T00:00:00Z",
  freshness: { status: "fresh", checkedAt: "2026-09-09T00:00:00Z", staleItems: [] }, missingItems: [],
  korea: { kospi: metric("KOSPI", 7000, 1, "pt"), kosdaq: metric("KOSDAQ", 800, 2, "pt"), investorFlows: [] },
  us: {}, macro: {},
};
let serial = 0;
async function generated(overrides: Partial<Parameters<typeof generateStockBlogImages>[0]>, check: (result: Awaited<ReturnType<typeof generateStockBlogImages>>, output: string) => Promise<void> | void) {
  const pipelineId = `test-image-explanation-${process.pid}-${serial++}`;
  const root = path.resolve("public/generated/stock-blog"), output = path.resolve(root, pipelineId);
  try {
    const result = await generateStockBlogImages({ pipelineId, template: "INVESTMENT_STUDY", title: "시장 자료를 읽는 방법", topic: "지수·수급·환율 확인 순서", body, referenceBundle: bundle, marketDate: "2026-09-09", ...overrides });
    await check(result, output);
  } finally {
    assert.equal(path.dirname(output), root);
    await rm(output, { recursive: true, force: true });
  }
}

test("본문과 신뢰 출처가 연결된 주제만 설명 이미지로 선택한다", () => {
  assert.deepEqual(planExplanatoryImages({ body, referenceBundle: bundle }).map(p => p.topicKey), ["market-breadth", "investor-flow", "rates-fx"]);
  for (const changed of [{ ...bundle, mode: "mock" as const }, { ...bundle, status: "error" as const }, { ...bundle, items: [] }]) {
    assert.equal(planExplanatoryImages({ body, referenceBundle: changed }).length, 0);
  }
  assert.equal(planExplanatoryImages({ body: "## 요리 순서\n\n국을 끓입니다.", referenceBundle: bundle }).length, 0);
  assert.equal(planExplanatoryImages({ body: "## 요리 순서\n\n국을 끓입니다.\n\n## 함께 확인한 기사\n\n국채금리와 환율", referenceBundle: bundle }).length, 0);
});

test("그래프가 없는 공부 글은 숫자를 만들지 않고 설명 이미지로 생성한다", async () => {
  await generated({}, async (result, output) => {
    assert.equal(result.imageStatus, "generated");
    assert.equal(result.imageQuality.status, "passed");
    assert.equal(result.imageQuality.chartImageCount, 0);
    assert.equal(result.imageQuality.bodyImageCount, 3);
    for (const img of result.contentImages.filter(i => i.role === "body")) {
      assert.ok(isVerifiedExplanatoryImage(img, { body, referenceBundle: bundle }));
      assert.equal(img.dataPoints.length, 0);
      const svg = await readFile(path.join(output, `${img.id}.svg`), "utf8");
      assert.match(svg, /시세 차트가 아닌/);
      assert.doesNotMatch(svg, /0\.00|조원|미확인 수치/);
    }
    const pipeline = { ...result, referenceBundle: bundle, writerResult: { fullDraft: body } } as unknown as ContentPipelineRun;
    assert.deepEqual(inspectStockBlogImagePublishReadiness(pipeline), []);
  });
});

test("수급·환율 누락 시 정상 지수 그래프는 보존하고 빠진 두 장만 대체한다", async () => {
  await generated({ template: "KOREA_DAILY_PREVIEW", marketSnapshot: snapshot }, result => {
    assert.equal(result.imageStatus, "generated");
    assert.deepEqual(result.contentImages.map(i => i.id), ["thumbnail", "major-index-change", "explain-investor-flow", "explain-rates-fx"]);
    assert.equal(result.imageQuality.chartImageCount, 1);
  });
});

test("장전 당일 두 지수 0%와 전부 0인 수급은 빈 그래프 대신 설명 이미지로 바꾼다", async () => {
  const empty = structuredClone(snapshot);
  empty.korea!.kospi = { ...empty.korea!.kospi!, changePct: 0, asOf: empty.marketDate };
  empty.korea!.kosdaq = { ...empty.korea!.kosdaq!, changePct: 0, asOf: empty.marketDate };
  empty.korea!.investorFlows = ["외국인", "기관", "개인"].map(label => metric(`KOSPI ${label} 순매수`, 0, undefined, "백만원"));
  await generated({ template: "KOREA_DAILY_PREVIEW", marketSnapshot: empty }, result => {
    assert.equal(result.imageStatus, "generated");
    assert.equal(result.imageQuality.chartImageCount, 0);
    assert.equal(result.contentImages.some(i => i.type === "chart"), false);
  });
});

test("오래된 환율은 정상 차트에 섞지 않고 관련 설명으로 대체한다", async () => {
  const stale = structuredClone(snapshot);
  stale.us!.fx = { ...metric("USD/KRW", 1300, -1, "원"), freshness: "stale" };
  await generated({ template: "KOREA_DAILY_PREVIEW", marketSnapshot: stale }, result => {
    assert.equal(result.imageStatus, "generated");
    assert.equal(result.contentImages.some(i => i.id === "fx-and-us-yields"), false);
    assert.ok(result.contentImages.some(i => i.id === "explain-rates-fx"));
  });
});

test("대체 이미지의 출처·본문을 바꾸면 저장된 통과 점수와 무관하게 발행을 막는다", async () => {
  await generated({}, result => {
    const wrong = structuredClone(result.contentImages);
    wrong[1].sourceUrl = "https://example.org/unrelated";
    assert.equal(evaluateStockBlogImageQuality(wrong, undefined, { body, referenceBundle: bundle }).status, "blocked");
    const pipeline = { ...result, contentImages: wrong, referenceBundle: bundle, writerResult: { fullDraft: body } } as unknown as ContentPipelineRun;
    assert.match(inspectStockBlogImagePublishReadiness(pipeline).join(" "), /재검증/);
    assert.equal(isVerifiedExplanatoryImage(result.contentImages[1], { body: "본문이 바뀌었습니다", referenceBundle: bundle }), false);
  });
});

test("설명 이미지가 있어도 본문 핵심 시세 자료가 없으면 시장 글 검증은 계속 차단한다", () => {
  const marketBundle = { ...bundle, contentType: "KOREA_DAILY_PREVIEW" as const };
  const gate = evaluateStockBlogReferences(marketBundle, true);
  assert.equal(gate.ok, false);
  assert.ok(gate.reasons.some(reason => /MarketSnapshot/.test(reason)));
});

test("출처가 없는 글과 알 수 없는 주제는 대체 이미지로 통과시키지 않는다", async () => {
  await generated({ referenceBundle: { ...bundle, items: [] } }, result => assert.equal(result.imageStatus, "failed"));
  await generated({ body: "## 다른 이야기\n\n아무 관계 없는 설명입니다." }, result => assert.equal(result.imageStatus, "failed"));
});
