import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluatePortfolioAutoSyncRun,
  getPortfolioAutoSyncConfig,
  getPortfolioSchedule,
  parseDailyCron,
} from "./portfolio-sync-scheduler-policy.ts";

test("defaults stay disabled at 08:30 Asia/Seoul with one retry", () => {
  const config = getPortfolioAutoSyncConfig({});
  assert.deepEqual(config, {
    enabled: false,
    cron: "30 8 * * *",
    timezone: "Asia/Seoul",
    retryLimit: 1,
  });
});

test("invalid cron and retry values are constrained to the safe policy", () => {
  assert.deepEqual(parseDailyCron("90 25 * * *"), { cron: "30 8 * * *", minute: 30, hour: 8 });
  const config = getPortfolioAutoSyncConfig({
    PORTFOLIO_ACCOUNT_AUTO_SYNC_ENABLED: "true",
    PORTFOLIO_ACCOUNT_AUTO_SYNC_RETRY_LIMIT: "9",
  });
  assert.equal(config.enabled, true);
  assert.equal(config.retryLimit, 1);
});

test("08:30 KST is 23:30 UTC on the previous date", () => {
  const config = getPortfolioAutoSyncConfig({});
  const schedule = getPortfolioSchedule(new Date("2026-07-25T00:00:00.000Z"), config);
  assert.equal(schedule.dateKey, "2026-07-25");
  assert.equal(schedule.scheduledAt.toISOString(), "2026-07-24T23:30:00.000Z");
  assert.equal(schedule.nextRunAt.toISOString(), "2026-07-25T23:30:00.000Z");
});

test("a failed run is retried only once and a success is idempotent", () => {
  const config = { ...getPortfolioAutoSyncConfig({ PORTFOLIO_ACCOUNT_AUTO_SYNC_ENABLED: "true" }), enabled: true };
  const now = new Date("2026-07-25T00:00:00.000Z");
  assert.equal(evaluatePortfolioAutoSyncRun(now, config, null).action, "run");
  assert.deepEqual(evaluatePortfolioAutoSyncRun(now, config, { status: "failed", attempt: 1 }), {
    action: "run",
    attempt: 2,
    schedule: getPortfolioSchedule(now, config),
  });
  assert.equal(evaluatePortfolioAutoSyncRun(now, config, { status: "failed", attempt: 2 }).action, "retry_exhausted");
  assert.equal(evaluatePortfolioAutoSyncRun(now, config, { status: "succeeded", attempt: 1 }).action, "already_ran");
});
