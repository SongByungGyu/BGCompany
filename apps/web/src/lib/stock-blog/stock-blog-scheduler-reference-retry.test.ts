import test from "node:test";
import assert from "node:assert/strict";
import { evaluateStockBlogSchedulerRetry } from "./stock-blog-scheduler-policy.ts";

test("reference preflight failures use the configured three-attempt recovery budget", () => {
  const decision = evaluateStockBlogSchedulerRetry({
    exists: true,
    status: "failed",
    previousAttempt: 2,
    elapsedMs: 10 * 60 * 1000,
    autoPublish: true,
    autoPublishRetryLimit: 0,
    maxRetries: 3,
    retryDelayMinutes: 10,
    referencePreflightFailure: true,
  });

  assert.deepEqual(decision, { allowed: true, attempt: 3 });
});

test("reference preflight recovery stops after the configured attempt budget", () => {
  const decision = evaluateStockBlogSchedulerRetry({
    exists: true,
    status: "failed",
    previousAttempt: 3,
    elapsedMs: 60 * 60 * 1000,
    autoPublish: true,
    autoPublishRetryLimit: 0,
    maxRetries: 3,
    retryDelayMinutes: 10,
    referencePreflightFailure: true,
  });

  assert.equal(decision.allowed, false);
  assert.equal(decision.attempt, 3);
});

test("retry timing tolerates scheduler-boundary completion drift", () => {
  const decision = evaluateStockBlogSchedulerRetry({
    exists: true,
    status: "failed",
    previousAttempt: 1,
    elapsedMs: 9 * 60 * 1000,
    autoPublish: true,
    autoPublishRetryLimit: 0,
    maxRetries: 3,
    retryDelayMinutes: 10,
    referencePreflightFailure: true,
  });

  assert.deepEqual(decision, { allowed: true, attempt: 2 });
});
