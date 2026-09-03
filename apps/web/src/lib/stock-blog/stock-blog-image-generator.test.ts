import test from "node:test";
import assert from "node:assert/strict";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import {
  generateStockBlogImages,
  getGenericMarketImagePolicy,
  getStockBlogImageThemeMarketLabels,
  isNvidiaEarningsSubject,
  isUsMarketStudySubject,
  selectGenericOverseasIndexChanges,
  usesUsFocusedGenericImages,
} from "./stock-blog-image-generator";
import type { MarketSnapshot, MarketSnapshotMetric } from "./references/reference-types";

const AS_OF = "2026-09-02T20:00:00.000Z";
const SOURCE_URL = "https://openapi.koreainvestment.com";

function verifiedMetric(input: Pick<MarketSnapshotMetric, "label" | "value" | "changePct" | "unit">): MarketSnapshotMetric {
  return {
    ...input,
    asOf: AS_OF,
    collectedAt: AS_OF,
    freshness: "fresh",
    provider: "kis",
    sourceName: "한국투자증권 Open API",
    url: SOURCE_URL,
  };
}

test("엔비디아가 시장 복기 사례로만 언급되면 실적 전용 이미지로 분류하지 않는다", () => {
  assert.equal(isNvidiaEarningsSubject({
    title: "나스닥 반등 이유와 미국 10년물 금리 숨고르기",
    topic: "국채금리 진정 뒤 엔비디아와 델 등 대표 기술주의 반응을 복기한다.",
  }), false);
});

test("엔비디아 실적·매출·가이던스 분석은 실적 전용 이미지로 분류한다", () => {
  assert.equal(isNvidiaEarningsSubject({
    title: "엔비디아 실적 발표 뒤 시간외 주가는 왜 올랐을까",
    topic: "분기 매출과 EPS, 다음 분기 가이던스를 공식 자료로 분석한다.",
  }), true);
});

test("미국증시·나스닥 복기 글은 미국시장 중심 이미지 대상으로 분류한다", () => {
  assert.equal(isUsMarketStudySubject({
    title: "나스닥 반등 이유와 미국 10년물 금리 숨고르기, 미국증시 복기",
    topic: "9월 2일 뉴욕증시를 금리와 기술주 흐름으로 정리한다.",
  }), true);
});

test("국내 수급 공부 글은 미국시장 중심 이미지 대상으로 분류하지 않는다", () => {
  assert.equal(isUsMarketStudySubject({
    title: "외국인 수급은 왜 코스피와 다르게 보였나",
    topic: "현물·선물·업종 확산으로 국내 수급을 공부한다.",
  }), false);
});

test("저녁 미국장 전망은 제목과 무관하게 미국 지수 전용 일반 이미지로 분류한다", () => {
  assert.equal(usesUsFocusedGenericImages({
    template: "KOREA_MARKET_CLOSE_US_PREVIEW",
    title: "한국장 마감 뒤 오늘 밤 체크할 변수",
    topic: "금리와 달러 흐름을 확인한다.",
  }), true);
  assert.deepEqual(
    getStockBlogImageThemeMarketLabels("KOREA_MARKET_CLOSE_US_PREVIEW"),
    ["S&P 500", "NASDAQ", "US 10Y"],
  );
});

test("저녁 미국장 전망의 일반 이미지에는 국내 지수와 코스피 수급을 넣지 않는다", () => {
  const input = {
    template: "KOREA_MARKET_CLOSE_US_PREVIEW",
    title: "오늘 미국장 전망",
    topic: "S&P500·나스닥·다우 흐름을 정리한다.",
  } as const;
  const policy = getGenericMarketImagePolicy(input);
  const displayedLabels = selectGenericOverseasIndexChanges(input, [
    { label: "S&P 500", value: 0.51 },
    { label: "NASDAQ", value: 1.02 },
    { label: "Dow Jones", value: 0 },
  ]).map((metric) => metric.label);

  assert.equal(policy.includeDomesticIndices, false);
  assert.equal(policy.includeInvestorFlowChart, false);
  assert.deepEqual(displayedLabels, ["S&P 500", "NASDAQ"]);
});

test("저녁 미국장 전망 생성 결과는 S&P500·나스닥만 남기고 국내 지수·수급·누락된 다우를 요구하지 않는다", async () => {
  const pipelineId = `test-evening-us-focused-${process.pid}`;
  const outputDir = path.join(process.cwd(), "public", "generated", "stock-blog", pipelineId);
  const snapshot: MarketSnapshot = {
    provider: "kis-fred",
    status: "ready",
    marketDate: "2026-09-03",
    collectedAt: AS_OF,
    dataQuality: "verified",
    fallbackUsed: false,
    freshness: { status: "fresh", checkedAt: AS_OF, staleItems: [] },
    korea: {
      kospi: verifiedMetric({ label: "KOSPI", value: 7110.31, changePct: -0.38, unit: "pt" }),
      kosdaq: verifiedMetric({ label: "KOSDAQ", value: 902.44, changePct: 0.21, unit: "pt" }),
      investorFlows: [
        verifiedMetric({ label: "KOSPI 외국인 순매수", value: -315000, unit: "백만원" }),
        verifiedMetric({ label: "KOSPI 기관 순매수", value: 122000, unit: "백만원" }),
        verifiedMetric({ label: "KOSPI 개인 순매수", value: 193000, unit: "백만원" }),
      ],
    },
    us: {
      sp500: verifiedMetric({ label: "S&P 500", value: 6488.12, changePct: 0.51, unit: "pt" }),
      nasdaq: verifiedMetric({ label: "NASDAQ", value: 21455.31, changePct: 1.02, unit: "pt" }),
      fx: verifiedMetric({ label: "USD/KRW", value: 1392.4, changePct: -0.14, unit: "원" }),
    },
    macro: {
      us2Year: verifiedMetric({ label: "미국 2년물", value: 3.61, unit: "%" }),
      us10Year: verifiedMetric({ label: "미국 10년물", value: 4.22, unit: "%" }),
      yieldSpread10Y2Y: verifiedMetric({ label: "10년-2년 금리차", value: 0.61, unit: "%p" }),
    },
    missingItems: [],
  };

  try {
    const result = await generateStockBlogImages({
      pipelineId,
      template: "KOREA_MARKET_CLOSE_US_PREVIEW",
      title: "미국장 전망: 금리와 달러가 흔드는 오늘 장세",
      topic: "S&P500과 나스닥 반등 뒤 오늘 밤 미국장 변수를 확인한다.",
      marketDate: "2026-09-03",
      marketSnapshot: snapshot,
    });
    const majorIndex = result.contentImages.find((image) => image.id === "major-index-change");
    const thumbnailSvg = await readFile(path.join(outputDir, "thumbnail.svg"), "utf8");
    const majorIndexSvg = await readFile(path.join(outputDir, "major-index-change.svg"), "utf8");
    const ratesAndFxSvg = await readFile(path.join(outputDir, "fx-and-us-yields.svg"), "utf8");

    assert.equal(result.imageStatus, "generated");
    assert.deepEqual(result.contentImages.map((image) => image.id), ["thumbnail", "major-index-change", "fx-and-us-yields"]);
    assert.deepEqual(majorIndex?.dataPoints.map((point) => point.label), ["S&P 500", "NASDAQ"]);
    assert.deepEqual(majorIndex?.dataKeys, ["us.sp500.changePct", "us.nasdaq.changePct"]);
    assert.doesNotMatch(thumbnailSvg, /KOSPI|KOSDAQ/);
    assert.match(majorIndexSvg, /S&amp;P 500/);
    assert.match(majorIndexSvg, /NASDAQ/);
    assert.match(ratesAndFxSvg, /미국 10년물/);
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});
