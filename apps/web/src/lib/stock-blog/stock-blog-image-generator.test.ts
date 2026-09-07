import test from "node:test";
import assert from "node:assert/strict";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import {
  generateStockBlogImages,
  getGenericMarketImagePolicy,
  getStockBlogImageThemeMarketLabels,
  isBroadcomEarningsSubject,
  isCpiScheduleSubject,
  isMarketHolidayStudySubject,
  isNvidiaEarningsSubject,
  isUsMarketStudySubject,
  selectGenericOverseasIndexChanges,
  usesUsFocusedGenericImages,
} from "./stock-blog-image-generator";
import type { MarketSnapshot, MarketSnapshotMetric, ReferenceBundle } from "./references/reference-types";
import { FRED_DEGRADED_DISCLOSURE } from "./references/fred-degraded-policy";

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

test("브로드컴 실적과 CPI 발표시간은 각각 주제 전용 이미지 대상으로 분류한다", () => {
  assert.equal(isBroadcomEarningsSubject({ title: "브로드컴 실적 발표", topic: "AVGO 매출과 AI 반도체 가이던스" }), true);
  assert.equal(isCpiScheduleSubject({ title: "미국 CPI 발표시간은 언제", topic: "BLS 공식 일정과 나스닥 영향" }), true);
});

test("휴장일 검색형 글은 휴장 전용 이미지 대상으로 분류한다", () => {
  assert.equal(isMarketHolidayStudySubject({
    title: "오늘 미국장 휴장인가요? 다음 개장일과 한국시간 거래시간",
    topic: "미국 증시 휴장이 확인됐고 다음 정규 개장일은 2026-09-08입니다.",
  }), true);
  assert.equal(isMarketHolidayStudySubject({
    title: "나스닥 마감과 금리 흐름",
    topic: "전일 미국장 등락을 복기합니다.",
  }), false);
});

test("브로드컴 투자공부 글은 시황 차트 대신 실적 전용 이미지만 만든다", async () => {
  const pipelineId = `test-broadcom-topic-${process.pid}`;
  const outputDir = path.join(process.cwd(), "public", "generated", "stock-blog", pipelineId);
  const sourceUrl = "https://investors.broadcom.com/news-releases/broadcom-results";
  const referenceBundle: ReferenceBundle = {
    provider: "web", mode: "real", status: "ready", contentType: "INVESTMENT_STUDY", generatedAt: AS_OF,
    marketDate: "2026-09-07", market: "US", queries: [], keyThemes: [], repeatedKeywords: [], differentiationPoints: [], cautionNotes: [], sourcePolicy: "official",
    items: [{ id: "official-broadcom-q3-fy2026-results", sourceType: "company", provider: "broadcom-ir", title: "Broadcom results", url: sourceUrl, reliability: "official", collectedAt: AS_OF, metrics: [
      { key: "broadcom.fy2026.q3.revenue", label: "3분기 매출", value: 29.6, unit: "십억달러", asOf: "2026-09-02", sourceName: "Broadcom IR", sourceUrl },
      { key: "broadcom.fy2026.q3.revenueGrowth", label: "매출 증가율", value: 86, unit: "%", asOf: "2026-09-02", sourceName: "Broadcom IR", sourceUrl },
      { key: "broadcom.fy2026.q4.revenueGuidance", label: "4분기 매출 가이던스", value: 34.8, unit: "십억달러", asOf: "2026-09-02", sourceName: "Broadcom IR", sourceUrl },
    ] }],
  };
  try {
    const result = await generateStockBlogImages({ pipelineId, template: "INVESTMENT_STUDY", title: "브로드컴 실적 발표", topic: "AVGO 매출과 AI 반도체 가이던스", marketDate: "2026-09-07", referenceBundle });
    assert.equal(result.imageStatus, "generated");
    assert.deepEqual(result.contentImages.map((image) => image.id), ["thumbnail", "broadcom-results", "broadcom-guidance", "broadcom-ai-path"]);
    assert.equal(result.contentImages.some((image) => ["major-index-change", "fx-and-us-yields"].includes(image.id)), false);
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test("CPI 발표시간 투자공부 글은 시황 차트 대신 일정 전용 이미지만 만든다", async () => {
  const pipelineId = `test-cpi-topic-${process.pid}`;
  const outputDir = path.join(process.cwd(), "public", "generated", "stock-blog", pipelineId);
  const sourceUrl = "https://www.bls.gov/schedule/2026/09_sched_list.htm";
  const referenceBundle: ReferenceBundle = {
    provider: "web", mode: "real", status: "ready", contentType: "INVESTMENT_STUDY", generatedAt: AS_OF,
    marketDate: "2026-09-07", market: "US", queries: [], keyThemes: [], repeatedKeywords: [], differentiationPoints: [], cautionNotes: [], sourcePolicy: "official",
    items: [{ id: "official-bls-september-2026-cpi-schedule", sourceType: "calendar", provider: "bls", title: "CPI schedule", url: sourceUrl, reliability: "official", facts: [{ key: "bls.cpi.releaseAt.2026-09", label: "CPI 발표 시각", value: "2026-09-11 08:30 ET · 한국시간 21:30", asOf: "2026-09-07", sourceName: "BLS", sourceUrl }] }],
  };
  try {
    const result = await generateStockBlogImages({ pipelineId, template: "INVESTMENT_STUDY", title: "9월 미국 CPI 발표시간은?", topic: "BLS 공식 일정과 나스닥 영향", marketDate: "2026-09-07", referenceBundle });
    assert.equal(result.imageStatus, "generated");
    assert.deepEqual(result.contentImages.map((image) => image.id), ["thumbnail", "cpi-release-time", "cpi-market-path", "cpi-check-order"]);
    assert.equal(result.contentImages.some((image) => ["major-index-change", "fx-and-us-yields"].includes(image.id)), false);
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test("미국장 휴장 검색형 글은 시황 차트 대신 휴장 일정·주문·체크 이미지를 만든다", async () => {
  const pipelineId = `test-us-holiday-topic-${process.pid}`;
  const outputDir = path.join(process.cwd(), "public", "generated", "stock-blog", pipelineId);
  const referenceBundle: ReferenceBundle = {
    provider: "web", mode: "real", status: "ready", contentType: "INVESTMENT_STUDY", generatedAt: AS_OF,
    marketDate: "2026-09-07", market: "US", queries: [], keyThemes: [], repeatedKeywords: [], differentiationPoints: [], cautionNotes: [], sourcePolicy: "official",
    items: [],
  };
  try {
    const result = await generateStockBlogImages({
      pipelineId,
      template: "INVESTMENT_STUDY",
      title: "오늘 미국장 휴장인가요? 다음 개장일과 한국시간 거래시간",
      topic: "2026-09-07 미국 증시 휴장이 확인됐습니다. 미국 거래소 정규 휴장일입니다. 다음 정규 개장일은 2026-09-08로 확인됐습니다.",
      marketDate: "2026-09-07",
      referenceBundle,
    });
    assert.equal(result.imageStatus, "generated");
    assert.deepEqual(result.contentImages.map((image) => image.id), ["thumbnail", "market-holiday-status", "market-holiday-order", "market-holiday-checklist"]);
    assert.equal(result.contentImages.some((image) => ["major-index-change", "fx-and-us-yields", "kospi-investor-flow"].includes(image.id)), false);
    assert.ok(result.contentImages.filter((image) => image.role === "body").every((image) => image.relevanceTags?.includes("market-holiday")));
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test("대형주 공시·실적 글은 시황 차트 대신 공식 발표 주제 이미지를 만든다", async () => {
  const pipelineId = `test-large-cap-topic-${process.pid}`;
  const outputDir = path.join(process.cwd(), "public", "generated", "stock-blog", pipelineId);
  const sourceUrl = "https://dart.fss.or.kr/dsaf001/main.do?rcpNo=20260907000001";
  const referenceBundle: ReferenceBundle = {
    provider: "web", mode: "real", status: "ready", contentType: "LARGE_CAP_DISCLOSURE_EARNINGS", generatedAt: AS_OF,
    marketDate: "2026-09-07", market: "KR", queries: [], keyThemes: [], repeatedKeywords: [], differentiationPoints: [], cautionNotes: [], sourcePolicy: "official",
    items: [{ id: "official-large-cap-kr-0", sourceType: "disclosure", provider: "opendart", title: "삼성전자 영업실적 등에 대한 전망", url: sourceUrl, reliability: "official", sourceName: "OpenDART", symbols: ["005930"], keywords: ["삼성전자", "005930", "공시"] }],
  };
  try {
    const result = await generateStockBlogImages({ pipelineId, template: "LARGE_CAP_DISCLOSURE_EARNINGS", title: "삼성전자 공시·실적 발표 핵심 숫자", topic: "삼성전자 공식 공시와 업종 영향", marketDate: "2026-09-07", referenceBundle });
    assert.equal(result.imageStatus, "generated");
    assert.deepEqual(result.contentImages.map((image) => image.id), ["thumbnail", "large-cap-announcements", "large-cap-impact-path", "large-cap-checklist"]);
    assert.equal(result.contentImages.some((image) => ["major-index-change", "fx-and-us-yields", "kospi-investor-flow"].includes(image.id)), false);
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test("전용 이미지 규칙이 없는 투자공부 글은 시황 차트로 대체하지 않는다", async () => {
  const result = await generateStockBlogImages({ pipelineId: `test-unknown-study-${process.pid}`, template: "INVESTMENT_STUDY", title: "낯선 투자 개념", topic: "별도 주제 이미지가 아직 없는 공부 글", marketDate: "2026-09-07" });
  assert.equal(result.imageStatus, "failed");
  assert.match(result.imageErrorMessage ?? "", /INVESTMENT_STUDY_TOPIC_IMAGE_TEMPLATE_MISSING/);
  assert.equal(result.contentImages.length, 0);
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

test("FRED 일부 지연 때 2년물과 금리차가 없어도 10년물로 저녁 차트를 만든다", async () => {
  const pipelineId = `test-evening-fred-degraded-${process.pid}`;
  const outputDir = path.join(process.cwd(), "public", "generated", "stock-blog", pipelineId);
  const snapshot: MarketSnapshot = {
    provider: "kis-fred",
    status: "ready",
    marketDate: "2026-09-04",
    collectedAt: AS_OF,
    dataQuality: "partial",
    fallbackUsed: false,
    degradedMode: "fred_unavailable",
    degradedProviders: ["fred"],
    disclosures: [FRED_DEGRADED_DISCLOSURE],
    freshness: { status: "fresh", checkedAt: AS_OF, staleItems: [] },
    korea: {
      kospi: verifiedMetric({ label: "KOSPI", value: 7110.31, changePct: -0.38, unit: "pt" }),
      kosdaq: verifiedMetric({ label: "KOSDAQ", value: 902.44, changePct: 0.21, unit: "pt" }),
      investorFlows: [],
    },
    us: {
      sp500: verifiedMetric({ label: "S&P 500", value: 6488.12, changePct: 0.51, unit: "pt" }),
      nasdaq: verifiedMetric({ label: "NASDAQ", value: 21455.31, changePct: 1.02, unit: "pt" }),
      fx: verifiedMetric({ label: "USD/KRW", value: 1392.4, changePct: -0.14, unit: "원" }),
    },
    macro: {
      us10Year: verifiedMetric({ label: "미국 10년물", value: 4.22, unit: "%" }),
    },
    missingItems: ["macro.us2Year", "macro.yieldSpread10Y2Y"],
  };

  try {
    const result = await generateStockBlogImages({
      pipelineId,
      template: "KOREA_MARKET_CLOSE_US_PREVIEW",
      title: "미국 고용보고서 앞두고 오늘 미국장 전망",
      topic: "나스닥과 미국 10년물 금리 흐름을 확인한다.",
      marketDate: "2026-09-04",
      marketSnapshot: snapshot,
    });
    const ratesImage = result.contentImages.find((image) => image.id === "fx-and-us-yields");
    const ratesSvg = await readFile(path.join(outputDir, "fx-and-us-yields.svg"), "utf8");

    assert.equal(result.imageStatus, "generated");
    assert.deepEqual(result.contentImages.map((image) => image.id), ["thumbnail", "major-index-change", "fx-and-us-yields"]);
    assert.deepEqual(ratesImage?.dataKeys, ["us.fx.value", "us.fx.changePct", "macro.us10Year.value"]);
    assert.match(ratesSvg, /미국 10년물/);
    assert.doesNotMatch(ratesSvg, /미국 2년물|10년-2년 금리차/);
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test("FRED 금리 전체 지연 때 검증된 환율만으로 빈 영역 없는 저녁 차트를 만든다", async () => {
  const pipelineId = `test-evening-fred-no-yields-${process.pid}`;
  const outputDir = path.join(process.cwd(), "public", "generated", "stock-blog", pipelineId);
  const snapshot: MarketSnapshot = {
    provider: "kis-fred",
    status: "ready",
    marketDate: "2026-09-04",
    collectedAt: AS_OF,
    dataQuality: "partial",
    fallbackUsed: false,
    degradedMode: "fred_unavailable",
    degradedProviders: ["fred"],
    disclosures: [FRED_DEGRADED_DISCLOSURE],
    freshness: { status: "fresh", checkedAt: AS_OF, staleItems: [] },
    korea: {
      kospi: verifiedMetric({ label: "KOSPI", value: 7110.31, changePct: -0.38, unit: "pt" }),
      kosdaq: verifiedMetric({ label: "KOSDAQ", value: 902.44, changePct: 0.21, unit: "pt" }),
      investorFlows: [],
    },
    us: {
      sp500: verifiedMetric({ label: "S&P 500", value: 6488.12, changePct: 0.51, unit: "pt" }),
      nasdaq: verifiedMetric({ label: "NASDAQ", value: 21455.31, changePct: 1.02, unit: "pt" }),
      fx: verifiedMetric({ label: "USD/KRW", value: 1392.4, changePct: -0.14, unit: "원" }),
    },
    macro: {},
    missingItems: ["미국 2년물 국채금리", "미국 10년물 국채금리"],
  };

  try {
    const result = await generateStockBlogImages({
      pipelineId,
      template: "KOREA_MARKET_CLOSE_US_PREVIEW",
      title: "미국 고용보고서 앞둔 나스닥 전망",
      topic: "나스닥과 원·달러 환율 흐름을 확인한다.",
      marketDate: "2026-09-04",
      marketSnapshot: snapshot,
    });
    const fxImage = result.contentImages.find((image) => image.id === "fx-and-us-yields");
    const fxSvg = await readFile(path.join(outputDir, "fx-and-us-yields.svg"), "utf8");

    assert.equal(result.imageStatus, "generated");
    assert.deepEqual(result.contentImages.map((image) => image.id), ["thumbnail", "major-index-change", "fx-and-us-yields"]);
    assert.equal(fxImage?.title, "원·달러 환율 현황");
    assert.deepEqual(fxImage?.dataKeys, ["us.fx.value", "us.fx.changePct"]);
    assert.match(fxSvg, /원·달러 환율 현황|원·달러 환율/);
    assert.doesNotMatch(fxSvg, /미국 2년물|미국 10년물|10년-2년 금리차/);
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});
