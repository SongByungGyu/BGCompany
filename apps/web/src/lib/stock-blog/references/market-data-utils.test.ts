import test from "node:test";
import assert from "node:assert/strict";
import { asNumber } from "./market-data-utils.ts";

test("시장 데이터의 빈 문자열을 0으로 변환하지 않는다", () => {
  assert.equal(asNumber(""), undefined);
  assert.equal(asNumber("   "), undefined);
  assert.equal(asNumber(","), undefined);
});

test("명시적인 0과 쉼표가 있는 숫자는 정상 변환한다", () => {
  assert.equal(asNumber("0"), 0);
  assert.equal(asNumber("1,234"), 1234);
});
