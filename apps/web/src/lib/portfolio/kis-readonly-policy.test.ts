import assert from "node:assert/strict";
import test from "node:test";
import {
  KIS_PROHIBITED_CAPABILITIES,
  KIS_READ_ONLY_ENDPOINTS,
  isKisReadOnlyRequestAllowed,
} from "./kis-readonly-policy.ts";

test("allows only the official read-only market-price requests", () => {
  assert.equal(isKisReadOnlyRequestAllowed(
    "GET",
    "/uapi/domestic-stock/v1/quotations/inquire-price",
    "FHKST01010100",
  ), true);
  assert.equal(isKisReadOnlyRequestAllowed(
    "GET",
    "/uapi/overseas-price/v1/quotations/price",
    "HHDFS00000300",
  ), true);
});

test("rejects mutations, mismatched TR IDs, and order paths", () => {
  assert.equal(isKisReadOnlyRequestAllowed(
    "POST",
    "/uapi/domestic-stock/v1/quotations/inquire-price",
    "FHKST01010100",
  ), false);
  assert.equal(isKisReadOnlyRequestAllowed(
    "GET",
    "/uapi/domestic-stock/v1/quotations/inquire-price",
    "TTTC0802U",
  ), false);
  assert.equal(isKisReadOnlyRequestAllowed(
    "GET",
    "/uapi/domestic-stock/v1/trading/inquire-balance",
    "TTTC8434R",
  ), false);
  assert.equal(isKisReadOnlyRequestAllowed(
    "POST",
    "/uapi/domestic-stock/v1/trading/order-cash",
    "TTTC0802U",
  ), false);
  assert.equal(Object.keys(KIS_READ_ONLY_ENDPOINTS).some((path) => path.includes("order")), false);
  assert.equal(KIS_PROHIBITED_CAPABILITIES.includes("buy"), true);
  assert.equal(KIS_PROHIBITED_CAPABILITIES.includes("sell"), true);
});
