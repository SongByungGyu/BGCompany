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
