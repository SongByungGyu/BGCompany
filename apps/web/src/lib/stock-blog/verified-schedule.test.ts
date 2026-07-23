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
  assert.match(String(applied.result.fullDraft), /7월 19일 일요일: FOMC Press Release/);
  assert.doesNotMatch(String(applied.result.fullDraft), /https:\/\/www\.federalreserve\.gov\/newsevents\/calendar\.htm/);
  assert.equal((applied.result.verifiedSchedule as { events: Array<{ url: string }> }).events[0]?.url, "https://www.federalreserve.gov/newsevents/calendar.htm");
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
  assert.match(String(applied.result.fullDraft), /4\. 다음 주 핵심 일정/);
  assert.match(String(applied.result.fullDraft), /7월 21일 화요일: US Employment/);
  assert.doesNotMatch(String(applied.result.fullDraft), /검증 범위|upcoming|https:\/\//);
  assert.doesNotMatch(String(applied.result.fullDraft), /Later Event/);
});

test("Writer가 선택한 검증 일정만 원래 섹션 위치에 공개하고 URL은 메타데이터에만 둔다", () => {
  const applied = applyVerifiedSchedule(writerResult([
    { heading: "1. 지난주 시장은 어땠을까", body: "지난주 흐름입니다." },
    { heading: "4. 다음 주 핵심 일정", body: "US Employment가 중요합니다." },
    { heading: "함께 확인한 기사", body: "1. 기사 – 언론사, 발행일\nhttps://news.example.com/article" },
  ]), snapshot({
    upcoming: [
      { date: "2026-07-21", event: "US Employment", market: "US", url: "https://official.example.com/jobs" },
      { date: "2026-07-22", event: "Other Event", market: "US", url: "https://official.example.com/other" },
    ],
  }), { contentType: "NEXT_WEEK_MARKET_PREVIEW" });
  const sections = applied.result.sections as Array<{ heading: string; body: string }>;

  assert.deepEqual(sections.map((section) => section.heading), ["1. 지난주 시장은 어땠을까", "4. 다음 주 핵심 일정", "함께 확인한 기사"]);
  assert.match(sections[1]?.body ?? "", /US Employment/);
  assert.doesNotMatch(sections[1]?.body ?? "", /Other Event|https:\/\//);
  assert.equal(applied.validation.checkedEventCount, 1);
});

test("일일 마감 글은 원래 번호 제목을 유지하고 가까운 일정만 사용한다", () => {
  const applied = applyVerifiedSchedule(writerResult([
    { heading: "1. 최근 시장은 어땠을까", body: "최근 시장 흐름입니다." },
    { heading: "4. 금리·환율·핵심 일정", body: "가까운 고용 일정을 확인합니다." },
    { heading: "함께 확인한 기사", body: "1. 기사 – 언론사, 발행일\nhttps://news.example.com/article" },
  ]), snapshot({
    marketDate: "2026-07-17",
    upcoming: [
      { date: "2026-07-21", event: "State Employment and Unemployment", market: "US", url: "https://example.com/employment" },
      { date: "2026-07-22", event: "State Job Openings and Labor Turnover", market: "US", url: "https://example.com/jolts" },
      { date: "2026-07-29", event: "Later Employment Event", market: "US", url: "https://example.com/later" },
    ],
  }), { contentType: "KOREA_MARKET_CLOSE_US_PREVIEW" });
  const sections = applied.result.sections as Array<{ heading: string; body: string }>;
  const scheduleSection = sections.find((section) => section.heading === "4. 금리·환율·핵심 일정");

  assert.ok(scheduleSection);
  assert.match(scheduleSection.body, /^- 7월 21일 화요일:/m);
  assert.match(scheduleSection.body, /고용 흐름이 경기 기대/);
  assert.match(scheduleSection.body, /노동 수요의 둔화 여부/);
  assert.doesNotMatch(scheduleSection.body, /7월 29일|Later Employment Event/);
  assert.equal(applied.validation.checkedEventCount, 2);
});

test("FOMC·환율·금리 일정은 서로 다른 중요도 문장으로 설명한다", () => {
  const applied = applyVerifiedSchedule(writerResult([
    { heading: "4. 금리·환율·핵심 일정", body: "FOMC와 환율, 금리 자료를 확인합니다." },
  ]), snapshot({
    marketDate: "2026-07-20",
    upcoming: [
      { date: "2026-07-20", event: "FOMC Press Release", market: "US", url: "https://example.com/fomc" },
      { date: "2026-07-20", event: "H.10 Foreign Exchange Rates", market: "US", url: "https://example.com/fx" },
      { date: "2026-07-20", event: "H.15 Selected Interest Rates", market: "US", url: "https://example.com/rates" },
    ],
  }), { contentType: "KOREA_MARKET_CLOSE_US_PREVIEW" });
  const scheduleBody = String(applied.result.fullDraft);

  assert.match(scheduleBody, /통화정책 신호/);
  assert.match(scheduleBody, /달러 흐름이 원·달러 환율/);
  assert.match(scheduleBody, /단기·장기 금리의 방향/);
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
