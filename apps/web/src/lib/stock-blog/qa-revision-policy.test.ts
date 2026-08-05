import assert from "node:assert/strict";
import test from "node:test";
import {
  buildStockBlogQaRevisionFeedback,
  shouldRetryStockBlogQa,
  STOCK_BLOG_MAX_HERMES_RUNS,
  STOCK_BLOG_MAX_QA_ATTEMPTS,
} from "./qa-revision-policy.ts";

test("allows at most three QA attempts and reserves eight Hermes runs", () => {
  assert.equal(STOCK_BLOG_MAX_QA_ATTEMPTS, 3);
  assert.equal(STOCK_BLOG_MAX_HERMES_RUNS, 8);
  assert.equal(shouldRetryStockBlogQa({ ok: true, qaScore: 88, publishReadiness: "needs_revision", finalRecommendation: "revise" }, 1), true);
  assert.equal(shouldRetryStockBlogQa({ ok: true, qaScore: 88, publishReadiness: "needs_revision", finalRecommendation: "revise" }, 3), false);
});

test("stops immediately after QA approval", () => {
  assert.equal(shouldRetryStockBlogQa({
    ok: true,
    qaScore: 97,
    publishReadiness: "ready",
    finalRecommendation: "approve",
    requiredRevisions: [],
  }, 1), false);
});

test("retries QA-approved output when deterministic editorial contract fails", () => {
  const qa = {
    ok: true,
    qaScore: 97,
    publishReadiness: "ready",
    finalRecommendation: "approve",
    requiredRevisions: [],
  };
  const writer = { fullDraft: "구조 없는 일반 본문입니다. ".repeat(120) };

  assert.equal(shouldRetryStockBlogQa(qa, 1, writer), true);
  assert.match(
    buildStockBlogQaRevisionFeedback(qa, writer).requiredRevisions.join("\n"),
    /편집 정책 v2 필수 수정: 30초 요약/,
  );
});

test("retries an approved draft when the final body is too short", () => {
  const qa = {
    ok: true,
    qaScore: 97,
    publishReadiness: "ready",
    finalRecommendation: "approve",
    requiredRevisions: [],
  };
  const writer = { fullDraft: "짧은 본문" };

  assert.equal(shouldRetryStockBlogQa(qa, 1, writer), true);
  assert.match(
    buildStockBlogQaRevisionFeedback(qa, writer).requiredRevisions[0] ?? "",
    /1800~2800자/,
  );
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
