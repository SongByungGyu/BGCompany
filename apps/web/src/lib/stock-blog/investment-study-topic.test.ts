import test from "node:test";
import assert from "node:assert/strict";
import {
  qualifiesForConditionalInvestmentStudy,
  selectInvestmentStudyTopic,
} from "./investment-study-topic.ts";
import type { ReferenceBundle } from "./references/reference-types";

function bundle(input: Partial<ReferenceBundle> = {}): ReferenceBundle {
  return {
    provider: "naver-search",
    mode: "real",
    status: "ready",
    contentType: "INVESTMENT_STUDY",
    generatedAt: "2026-08-13T03:00:00.000Z",
    marketDate: "2026-08-13",
    market: "GLOBAL",
    queries: [],
    items: [],
    keyThemes: [],
    repeatedKeywords: [],
    differentiationPoints: [],
    cautionNotes: [],
    sourcePolicy: "test",
    missingItems: [],
    ...input,
  };
}

test("selects a KOSPI flow lesson when the index moves sharply", () => {
  const selection = selectInvestmentStudyTopic({
    now: new Date("2026-08-13T03:10:00.000Z"),
    referenceBundle: bundle({
      marketSnapshot: {
        provider: "kis-fred",
        status: "ready",
        marketDate: "2026-08-13",
        collectedAt: "2026-08-13T03:00:00.000Z",
        dataQuality: "verified",
        freshness: { status: "fresh", checkedAt: "2026-08-13T03:00:00.000Z", staleItems: [] },
        korea: { kospi: { label: "KOSPI", value: 6813, changePct: 2.34, direction: "up" } },
        missingItems: [],
      },
    }),
  });

  assert.equal(selection.mode, "market_issue");
  assert.match(selection.title, /코스피 \+2\.34%/);
  assert.match(selection.topic, /외국인/);
  assert.equal(qualifiesForConditionalInvestmentStudy(selection), true);
});

test("selects a Nasdaq rate lesson when the US market moves sharply", () => {
  const selection = selectInvestmentStudyTopic({
    now: new Date("2026-08-13T03:10:00.000Z"),
    referenceBundle: bundle({
      marketSnapshot: {
        provider: "kis-fred",
        status: "ready",
        marketDate: "2026-08-13",
        collectedAt: "2026-08-13T03:00:00.000Z",
        dataQuality: "verified",
        freshness: { status: "fresh", checkedAt: "2026-08-13T03:00:00.000Z", staleItems: [] },
        us: { nasdaq: { label: "NASDAQ", value: 26588, changePct: -1.71, direction: "down" } },
        missingItems: [],
      },
    }),
  });

  assert.equal(selection.mode, "market_issue");
  assert.match(selection.title, /나스닥 -1\.71%/);
  assert.match(selection.topic, /국채금리/);
  assert.equal(qualifiesForConditionalInvestmentStudy(selection), true);
});

test("combines fresh PPI coverage and a verified schedule into an issue lesson", () => {
  const selection = selectInvestmentStudyTopic({
    now: new Date("2026-08-13T03:10:00.000Z"),
    referenceBundle: bundle({
      items: [
        { id: "news-1", sourceType: "news", provider: "naver", title: "PPI 발표 앞두고 나스닥 변동성 확대", publishedAt: "2026-08-13T01:00:00.000Z" },
        { id: "news-2", sourceType: "news", provider: "naver", title: "생산자물가 예상보다 높을까", publishedAt: "2026-08-13T02:00:00.000Z" },
      ],
      marketSnapshot: {
        provider: "kis-fred",
        status: "ready",
        marketDate: "2026-08-13",
        collectedAt: "2026-08-13T03:00:00.000Z",
        dataQuality: "verified",
        freshness: { status: "fresh", checkedAt: "2026-08-13T03:00:00.000Z", staleItems: [] },
        upcoming: [{ date: "2026-08-13", event: "Producer Price Index", market: "US" }],
        missingItems: [],
      },
    }),
  });

  assert.equal(selection.mode, "market_issue");
  assert.match(selection.title, /PPI·CPI/);
  assert.equal(selection.score, 4);
  assert.equal(qualifiesForConditionalInvestmentStudy(selection), true);
});

test("falls back to a concrete search question when the market is quiet", () => {
  const selection = selectInvestmentStudyTopic({
    now: new Date("2026-08-13T03:10:00.000Z"),
    referenceBundle: bundle(),
  });

  assert.equal(selection.mode, "search_question");
  assert.match(selection.title, /까|이유/);
  assert.equal(selection.score, 0);
  assert.equal(qualifiesForConditionalInvestmentStudy(selection), false);
});

test("does not treat undated or stale news as a current market issue", () => {
  const selection = selectInvestmentStudyTopic({
    now: new Date("2026-08-13T03:10:00.000Z"),
    referenceBundle: bundle({
      items: [
        { id: "undated", sourceType: "news", provider: "naver", title: "반도체 급등과 외국인 순매수" },
        { id: "stale", sourceType: "news", provider: "naver", title: "반도체 신고가와 외국인 수급", publishedAt: "2026-08-01T02:00:00.000Z" },
      ],
    }),
  });

  assert.equal(selection.mode, "search_question");
  assert.equal(qualifiesForConditionalInvestmentStudy(selection), false);
});

test("Tuesday prioritizes a verified upcoming CPI search question", () => {
  const selection = selectInvestmentStudyTopic({
    now: new Date("2026-08-18T03:10:00.000Z"),
    angle: "upcoming_question",
    referenceBundle: bundle({
      marketDate: "2026-08-18",
      marketSnapshot: {
        provider: "kis-fred",
        status: "ready",
        marketDate: "2026-08-18",
        collectedAt: "2026-08-18T03:00:00.000Z",
        dataQuality: "verified",
        freshness: { status: "fresh", checkedAt: "2026-08-18T03:00:00.000Z", staleItems: [] },
        upcoming: [{ date: "2026-08-21", event: "Consumer Price Index", market: "US" }],
        missingItems: [],
      },
    }),
  });

  assert.equal(selection.mode, "search_question");
  assert.match(selection.title, /미국 CPI 발표시간/);
  assert.equal(selection.score, 2);
  assert.equal(qualifiesForConditionalInvestmentStudy(selection), false);
});

test("an extreme market move takes priority over an upcoming schedule question", () => {
  const selection = selectInvestmentStudyTopic({
    now: new Date("2026-08-18T03:10:00.000Z"),
    angle: "upcoming_question",
    referenceBundle: bundle({
      marketDate: "2026-08-18",
      marketSnapshot: {
        provider: "kis-fred",
        status: "ready",
        marketDate: "2026-08-18",
        collectedAt: "2026-08-18T03:00:00.000Z",
        dataQuality: "verified",
        freshness: { status: "fresh", checkedAt: "2026-08-18T03:00:00.000Z", staleItems: [] },
        korea: { kospi: { label: "KOSPI", value: 6800, changePct: -2.4, direction: "down" } },
        upcoming: [{ date: "2026-08-19", event: "Consumer Price Index", market: "US" }],
        missingItems: [],
      },
    }),
  });

  assert.equal(selection.mode, "market_issue");
  assert.match(selection.title, /코스피 -2\.4%/);
});

test("Thursday prioritizes a verified NVIDIA earnings result over an extreme market move", () => {
  const selection = selectInvestmentStudyTopic({
    now: new Date("2026-08-27T03:10:00.000Z"),
    angle: "result_or_practical",
    referenceBundle: bundle({
      marketDate: "2026-08-27",
      items: [
        {
          id: "official-nvda",
          sourceType: "disclosure",
          provider: "sec-edgar",
          title: "NVIDIA CORP 8-K 공식 제출",
          publishedAt: "2026-08-26",
          publisher: "SEC EDGAR",
          reliability: "official",
          symbols: ["NVDA"],
          summary: "NVIDIA가 SEC에 Item 2.02 실적 자료를 제출했습니다.",
        },
        {
          id: "news-nvda",
          sourceType: "news",
          provider: "naver",
          title: "엔비디아 실적 발표 뒤 시간외 주가 상승",
          publishedAt: "2026-08-27T01:00:00.000Z",
        },
      ],
      marketSnapshot: {
        provider: "kis-fred",
        status: "ready",
        marketDate: "2026-08-27",
        collectedAt: "2026-08-27T03:00:00.000Z",
        dataQuality: "verified",
        freshness: { status: "fresh", checkedAt: "2026-08-27T03:00:00.000Z", staleItems: [] },
        korea: { kospi: { label: "KOSPI", value: 7000, changePct: 2.4, direction: "up" } },
        missingItems: [],
      },
    }),
  });

  assert.equal(selection.mode, "market_issue");
  assert.match(selection.title, /엔비디아 실적 발표/);
  assert.match(selection.title, /삼성전자·SK하이닉스 영향/);
  assert.match(selection.topic, /공식 실적 자료/);
  assert.equal(selection.score, 5);
  assert.equal(qualifiesForConditionalInvestmentStudy(selection), true);
});
