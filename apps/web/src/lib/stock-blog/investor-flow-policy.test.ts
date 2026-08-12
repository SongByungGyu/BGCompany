import test from "node:test";
import assert from "node:assert/strict";
import {
  buildInvestorFlowChartCopy,
  formatInvestorFlowChartValues,
  getInvestorFlowBusinessDateCandidates,
  hasMeaningfulInvestorFlowValues,
  isInvestorFlowDateEligible,
} from "./investor-flow-policy.ts";

test("장전 한국장 전망은 당일이 아닌 직전 평일 수급부터 조회한다", () => {
  const tuesdayMorningKst = new Date("2026-08-10T22:20:00.000Z");
  assert.deepEqual(
    getInvestorFlowBusinessDateCandidates("KOREA_DAILY_PREVIEW", tuesdayMorningKst, 3),
    ["20260810", "20260807", "20260806"],
  );
});

test("월요일 장전에는 직전 금요일 수급부터 조회한다", () => {
  const mondayMorningKst = new Date("2026-08-09T22:20:00.000Z");
  assert.equal(getInvestorFlowBusinessDateCandidates("KOREA_DAILY_PREVIEW", mondayMorningKst, 1)[0], "20260807");
});

test("장 마감 뒤 글은 당일 수급부터 조회한다", () => {
  const tuesdayCloseKst = new Date("2026-08-11T08:00:00.000Z");
  assert.equal(getInvestorFlowBusinessDateCandidates("KOREA_MARKET_CLOSE_US_PREVIEW", tuesdayCloseKst, 1)[0], "20260811");
});

test("외국인·기관·개인이 전부 0이면 의미 없는 수급 시리즈로 본다", () => {
  assert.equal(hasMeaningfulInvestorFlowValues([0, 0, 0]), false);
  assert.equal(hasMeaningfulInvestorFlowValues([1, 0, -1]), true);
  assert.equal(hasMeaningfulInvestorFlowValues([1, 0]), false);
});

test("장전 전망 차트는 세 투자주체의 동일한 전일 확정일만 허용한다", () => {
  assert.equal(isInvestorFlowDateEligible(
    "KOREA_DAILY_PREVIEW",
    "2026-08-12",
    ["2026-08-11T00:00:00.000Z", "2026-08-11T00:00:00.000Z", "2026-08-11T00:00:00.000Z"],
  ), true);
  assert.equal(isInvestorFlowDateEligible(
    "KOREA_DAILY_PREVIEW",
    "2026-08-12",
    ["2026-08-12T00:00:00.000Z", "2026-08-12T00:00:00.000Z", "2026-08-12T00:00:00.000Z"],
  ), false);
  assert.equal(isInvestorFlowDateEligible(
    "KOREA_DAILY_PREVIEW",
    "2026-08-12",
    ["2026-08-11", "2026-08-10", "2026-08-11"],
  ), false);
});

test("장 마감 뒤 글은 당일 확정 수급을 허용한다", () => {
  assert.equal(isInvestorFlowDateEligible(
    "KOREA_MARKET_CLOSE_US_PREVIEW",
    "26/08/12",
    ["2026-08-12", "2026-08-12", "2026-08-12"],
  ), true);
});

test("장전 차트 문구는 전일 확정값과 오늘 시나리오를 분리한다", () => {
  const copy = buildInvestorFlowChartCopy("KOREA_DAILY_PREVIEW", "8월 11일", "단위 안내");
  assert.equal(copy.title, "전일 KOSPI 투자자별 확정 수급｜8월 11일");
  assert.match(copy.subtitle, /오늘 수급 전망치가 아닙니다/);
  assert.match(copy.caption, /연속·반전 여부/);
});

test("작은 실제 수급은 억원 단위로 표시해 0.00조원 반올림을 피한다", () => {
  const formatted = formatInvestorFlowChartValues([1, -1, 0]);
  assert.equal(formatted.unit, "억원");
  assert.deepEqual(formatted.values.map((item) => item.display), ["+0.01억원", "-0.01억원", "0.00억원"]);
});

test("수백억원대 수급은 억원 단위로 읽기 쉽게 표시한다", () => {
  const formatted = formatInvestorFlowChartValues([44_283, 30_459, -70_705]);
  assert.equal(formatted.unit, "억원");
  assert.deepEqual(formatted.values.map((item) => item.display), ["+442.83억원", "+304.59억원", "-707.05억원"]);
});

test("천억원 이상 수급은 조원 단위로 표시한다", () => {
  const formatted = formatInvestorFlowChartValues([120_000, 30_459, -170_705]);
  assert.equal(formatted.unit, "조원");
  assert.deepEqual(formatted.values.map((item) => item.display), ["+0.12조원", "+0.03조원", "-0.17조원"]);
});
