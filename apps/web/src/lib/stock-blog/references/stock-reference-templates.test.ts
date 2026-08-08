import test from "node:test";
import assert from "node:assert/strict";
import { getStockReferenceTemplate } from "./stock-reference-templates.ts";

test("오전 글은 전일 한국장·간밤 미국장·오늘 변수로 자료 계약을 구성한다", () => {
  const template = getStockReferenceTemplate("KOREA_DAILY_PREVIEW");

  assert.equal(template.market, "KR");
  assert.deepEqual(template.requirements.map((item) => item.id), [
    "kr-previous-close",
    "us-overnight",
    "fx-sector-events",
  ]);
});

test("17시 글은 미국장 전망이 본문 중심이고 한국장은 연결 신호로만 구성한다", () => {
  const template = getStockReferenceTemplate("KOREA_MARKET_CLOSE_US_PREVIEW");

  assert.equal(template.market, "US");
  assert.deepEqual(template.requirements.map((item) => item.id), [
    "us-previous-close",
    "us-preview",
    "kr-handoff",
  ]);
  assert.match(template.requirements[2]?.label ?? "", /연결 신호/);
});

test("토요일은 한국·미국 주간 복기, 일요일은 다음 주 일정·조건 자료 계약을 사용한다", () => {
  const saturday = getStockReferenceTemplate("WEEKLY_MARKET_REVIEW");
  const sunday = getStockReferenceTemplate("NEXT_WEEK_MARKET_PREVIEW");

  assert.equal(saturday.market, "GLOBAL");
  assert.deepEqual(saturday.requirements.map((item) => item.id), [
    "weekly-global-index",
    "weekly-sector-flow",
    "weekly-drivers",
  ]);
  assert.equal(saturday.requirements.some((item) => item.label.includes("다음 주")), false);
  assert.deepEqual(sunday.requirements.map((item) => item.id), [
    "last-week-global",
    "next-week-calendar",
    "investor-checklist",
  ]);
});

test("투자 공부와 대형주 공시·실적은 별도 자료 계약을 사용한다", () => {
  const study = getStockReferenceTemplate("INVESTMENT_STUDY");
  const disclosure = getStockReferenceTemplate("LARGE_CAP_DISCLOSURE_EARNINGS");
  assert.deepEqual(study.requirements.map((item) => item.id), ["study-definition", "study-example", "study-caution"]);
  assert.deepEqual(disclosure.requirements.map((item) => item.id), ["official-release", "earnings-numbers", "market-impact"]);
  assert.ok(disclosure.requirements[0]?.sourceTypes.includes("disclosure"));
});
