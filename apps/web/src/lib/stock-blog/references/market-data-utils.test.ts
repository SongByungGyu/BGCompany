import test from "node:test";
import assert from "node:assert/strict";
import { asNumber, marketSessionAdjustedFreshness, mostRecentCompletedNyseSessionDate } from "./market-data-utils.ts";

test("시장 데이터의 빈 문자열을 0으로 변환하지 않는다", () => {
  assert.equal(asNumber(""), undefined);
  assert.equal(asNumber("   "), undefined);
  assert.equal(asNumber(","), undefined);
});

test("명시적인 0과 쉼표가 있는 숫자는 정상 변환한다", () => {
  assert.equal(asNumber("0"), 0);
  assert.equal(asNumber("1,234"), 1234);
});

test("미국 노동절 다음 한국장 아침에는 금요일 종가를 마지막 완료 거래일로 인정한다", () => {
  const tuesdayMorningKst = new Date("2026-09-08T00:00:00.000Z");
  assert.equal(mostRecentCompletedNyseSessionDate(tuesdayMorningKst), "2026-09-04");
  assert.equal(
    marketSessionAdjustedFreshness("2026-09-04T00:00:00.000Z", 4320, tuesdayMorningKst, "NYSE").freshness,
    "fresh",
  );
});

test("마지막 완료 거래일보다 오래된 미국 지수는 휴장 뒤에도 최신으로 올리지 않는다", () => {
  const tuesdayMorningKst = new Date("2026-09-08T00:00:00.000Z");
  assert.notEqual(
    marketSessionAdjustedFreshness("2026-09-03T00:00:00.000Z", 4320, tuesdayMorningKst, "NYSE").freshness,
    "fresh",
  );
});
