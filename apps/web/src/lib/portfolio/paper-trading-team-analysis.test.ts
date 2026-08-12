import assert from "node:assert/strict";
import test from "node:test";
import { buildPaperTradingTeamReviewDrafts } from "./paper-trading-team-analysis.ts";

const base = {
  marketDate: "2026-08-11",
  initialCapitalKrw: 10_000_000,
  cashKrw: 7_000_000,
  equityKrw: 9_950_000,
  marketValueKrw: 2_950_000,
  openPositions: 3,
  acceptedSignals: 3,
  rejectedSignals: 1,
  filledOrders: 3,
  rejectedOrders: 0,
  fills: 3,
  riskEventCount: 1,
  highRiskEventCount: 0,
  configuredSlippageBps: 15,
  averageSlippageBps: 15,
};

test("builds three independent trader reviews", () => {
  const reviews = buildPaperTradingTeamReviewDrafts(base);
  assert.deepEqual(reviews.map((review) => review.role), ["LEAD_ANALYST", "RISK_MANAGER", "EXECUTION_REVIEWER"]);
  assert.equal(reviews[0].recommendation, "FOLLOW_LOCKED_PLAN");
  assert.equal(reviews[1].recommendation, "RISK_CLEAR");
  assert.equal(reviews[2].recommendation, "EXECUTION_OK");
});

test("requires risk review when exposure or a high-risk event breaches policy", () => {
  const reviews = buildPaperTradingTeamReviewDrafts({ ...base, marketValueKrw: 8_500_000, highRiskEventCount: 1 });
  assert.equal(reviews[1].recommendation, "RISK_REVIEW_REQUIRED");
});

test("flags an execution mismatch", () => {
  const reviews = buildPaperTradingTeamReviewDrafts({ ...base, fills: 2 });
  assert.equal(reviews[2].recommendation, "EXECUTION_REVIEW_REQUIRED");
  assert.equal(reviews[2].details.executionMismatch, true);
});
