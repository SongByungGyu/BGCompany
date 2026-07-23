import assert from "node:assert/strict";
import test from "node:test";
import {
  buildStockBlogQaRevisionFeedback,
  shouldRetryStockBlogQa,
  STOCK_BLOG_MAX_HERMES_RUNS,
  STOCK_BLOG_MAX_QA_ATTEMPTS,
} from "./qa-revision-policy";

test("allows at most three QA attempts and reserves eight Hermes runs", () => {
  assert.equal(STOCK_BLOG_MAX_QA_ATTEMPTS, 3);
  assert.equal(STOCK_BLOG_MAX_HERMES_RUNS, 8);
  assert.equal(shouldRetryStockBlogQa({ ok: true, qaScore: 88, publishReadiness: "needs_revision", finalRecommendation: "revise" }, 1), true);
  assert.equal(shouldRetryStockBlogQa({ ok: true, qaScore: 88, publishReadiness: "needs_revision", finalRecommendation: "revise" }, 3), false);
});

test("stops immediately after QA approval", () => {
  assert.equal(shouldRetryStockBlogQa({
    ok: true,
    qaScore: 94,
    publishReadiness: "ready",
    finalRecommendation: "approve",
    requiredRevisions: [],
  }, 1), false);
});

test("passes only actionable QA fields back to the writer", () => {
  assert.deepEqual(buildStockBlogQaRevisionFeedback({
    ok: true,
    qaScore: 88,
    requiredRevisions: ["미국 3대 지수 표현 수정", 123, ""],
    typoAndStyleNotes: ["어색한 문장 수정"],
    raw: { prompt: "do not forward" },
  }), {
    qaSummary: undefined,
    factCheckNotes: [],
    qualityNotes: [],
    riskNotes: [],
    typoAndStyleNotes: ["어색한 문장 수정"],
    requiredRevisions: ["미국 3대 지수 표현 수정"],
    optionalSuggestions: [],
    publishReadiness: undefined,
    qaScore: 88,
    finalRecommendation: undefined,
    reason: undefined,
  });
});
