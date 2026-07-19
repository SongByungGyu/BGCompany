import test from "node:test";
import assert from "node:assert/strict";
import type { MarketSnapshot } from "./references/reference-types";
import { applyVerifiedSchedule } from "./verified-schedule";

function snapshot(overrides?: Partial<MarketSnapshot>): MarketSnapshot {
  return {
    provider: "kis-fred",
    status: "ready",
    marketDate: "2026-07-19",
    collectedAt: "2026-07-19T03:00:00Z",
    dataQuality: "verified",
    upcoming: [{
      date: "2026-07-19",
      event: "FOMC Press Release",
      market: "US",
      sourceName: "Federal Reserve",
      url: "https://www.federalreserve.gov/newsevents/calendar.htm",
    }],
    missingItems: [],
    ...overrides,
  };
}

function writerResult(sections: Array<{ heading: string; body: string }>) {
  return {
    ok: true,
    provider: "hermes-bridge",
    agentId: "content-writer",
    finalTitle: "다음 주 시장 일정",
    metaDescription: "검증된 일정을 정리합니다.",
    introduction: "최근 거래일 기준 시장 흐름을 정리합니다.",
    sections,
    conclusion: "원문 일정을 다시 확인하세요.",
    cta: "체크리스트를 저장해두세요.",
  };
}

test("Writer가 바꾼 일정 날짜를 검증값으로 교체한다", () => {
  const applied = applyVerifiedSchedule(writerResult([
    { heading: "데이터 기준", body: "시장 데이터의 기준일은 2026-07-19입니다." },
    { heading: "다음 주 주요 일정", body: "2026-07-20 FOMC Press Release를 확인합니다." },
  ]), snapshot());

  assert.equal(applied.validation.ok, true);
  assert.equal(applied.validation.checkedEventCount, 1);
  assert.match(String(applied.result.fullDraft), /2026-07-19 · FOMC Press Release/);
  assert.match(String(applied.result.fullDraft), /https:\/\/www\.federalreserve\.gov\/newsevents\/calendar\.htm/);
  assert.doesNotMatch(String(applied.result.fullDraft), /2026-07-20 FOMC Press Release/);
});

test("일정 섹션 밖에 남은 잘못된 날짜를 QA 전에 차단한다", () => {
  const applied = applyVerifiedSchedule(writerResult([
    { heading: "데이터 기준", body: "시장 데이터의 기준일은 2026-07-19입니다." },
    { heading: "관찰 포인트", body: "FOMC Press Release는 7월 20일 발표될 예정입니다." },
  ]), snapshot());

  assert.equal(applied.validation.ok, false);
  assert.match(applied.validation.issues.join("\n"), /2026-07-20.*2026-07-19/);
});

test("검증 일정의 원문 URL이 없으면 차단한다", () => {
  const applied = applyVerifiedSchedule(writerResult([
    { heading: "데이터 기준", body: "시장 데이터의 기준일은 2026-07-19입니다." },
  ]), snapshot({ upcoming: [{ date: "2026-07-19", event: "FOMC Press Release" }] }));

  assert.equal(applied.validation.ok, false);
  assert.match(applied.validation.issues.join("\n"), /원문 URL이 없습니다/);
});

test("다음 주 글은 검증 범위 밖 일정을 제외하고 누락 시장을 고지한다", () => {
  const applied = applyVerifiedSchedule(writerResult([
    { heading: "데이터 기준", body: "시장 데이터의 기준일은 2026-07-19입니다." },
  ]), snapshot({
    upcoming: [
      { date: "2026-07-21", event: "US Employment", market: "US", url: "https://example.com/us" },
      { date: "2026-07-29", event: "Later Event", market: "US", url: "https://example.com/later" },
    ],
  }), { contentType: "NEXT_WEEK_MARKET_PREVIEW" });

  assert.equal(applied.validation.ok, true);
  assert.equal(applied.validation.checkedEventCount, 1);
  assert.match(String(applied.result.fullDraft), /검증 범위: 2026-07-20~2026-07-26/);
  assert.match(String(applied.result.fullDraft), /한국 일정은 검증된 upcoming 데이터에 없어 추가 확인 필요/);
  assert.doesNotMatch(String(applied.result.fullDraft), /Later Event/);
});

test("혼합 강약 목록을 섹터가 아닌 시장 항목으로 명확히 표시한다", () => {
  const applied = applyVerifiedSchedule(writerResult([
    { heading: "강세/약세 섹터", body: "강세 섹터에는 통신과 지수가 포함됩니다. 약세 섹터도 확인합니다." },
  ]), snapshot());
  const fullDraft = String(applied.result.fullDraft);

  assert.match(fullDraft, /강세\/약세 시장 항목/);
  assert.match(fullDraft, /순수 업종 외에 지수·테마·상품이 포함될 수 있습니다/);
  assert.doesNotMatch(fullDraft, /강세\/약세 섹터/);
});
