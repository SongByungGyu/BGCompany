import assert from "node:assert/strict";
import test from "node:test";
import {
  TOSS_PROHIBITED_CAPABILITIES,
  TOSS_READ_ONLY_ENDPOINTS,
  isTossRequestAllowed,
} from "./toss-readonly-policy.ts";

test("allows only OAuth issuance and official read-only account requests", () => {
  assert.equal(isTossRequestAllowed("POST", "/oauth2/token"), true);
  assert.equal(isTossRequestAllowed("GET", "/api/v1/accounts"), true);
  assert.equal(isTossRequestAllowed("GET", "/api/v1/holdings"), true);
});

test("rejects account mutations and every order path", () => {
  assert.equal(isTossRequestAllowed("GET", "/oauth2/token"), false);
  assert.equal(isTossRequestAllowed("POST", "/api/v1/holdings"), false);
  assert.equal(isTossRequestAllowed("POST", "/api/v1/orders"), false);
  assert.equal(isTossRequestAllowed("DELETE", "/api/v1/orders/1"), false);
  assert.equal(TOSS_READ_ONLY_ENDPOINTS.some((path) => path.includes("order")), false);
  assert.equal(TOSS_PROHIBITED_CAPABILITIES.includes("buy"), true);
  assert.equal(TOSS_PROHIBITED_CAPABILITIES.includes("sell"), true);
});
