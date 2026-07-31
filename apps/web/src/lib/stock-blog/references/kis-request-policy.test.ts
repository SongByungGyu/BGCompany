import test from "node:test";
import assert from "node:assert/strict";
import {
  getKisMinRequestIntervalMs,
  KIS_MAX_RETRIES,
  KIS_PROHIBITED_CAPABILITIES,
  KIS_RETRYABLE_RESPONSE_CODES,
} from "./kis-request-policy.ts";

test("KIS 조회 정책은 연속 호출 제한 코드를 재시도하고 요청 간격을 둔다", () => {
  assert.deepEqual(Array.from(KIS_RETRYABLE_RESPONSE_CODES), ["EGW00201"]);
  assert.equal(getKisMinRequestIntervalMs(), 800);
  assert.equal(getKisMinRequestIntervalMs("1200"), 1200);
  assert.equal(getKisMinRequestIntervalMs("invalid"), 800);
  assert.equal(KIS_MAX_RETRIES, 2);
});

test("KIS 조회 정책은 주문·계좌 기능을 금지한다", () => {
  assert.deepEqual(
    KIS_PROHIBITED_CAPABILITIES,
    ["order", "balance", "account", "position", "buy", "sell"],
  );
});
