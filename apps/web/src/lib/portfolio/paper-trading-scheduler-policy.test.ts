import assert from "node:assert/strict";
import test from "node:test";
import { decidePaperTradingSchedulerRun, evaluatePaperTradingTrial, getPaperTradingSchedulerConfig } from "./paper-trading-scheduler-policy.ts";

const config = getPaperTradingSchedulerConfig({
  PAPER_AUTO_SCHEDULER_ENABLED: "true",
  PAPER_AUTO_SCHEDULER_CRON: "20 7 * * *",
  PAPER_AUTO_SCHEDULER_TZ: "Asia/Seoul",
  PAPER_AUTO_SCHEDULER_RETRY_LIMIT: "1",
  PAPER_TRIAL_START_DATE: "2026-08-10",
  PAPER_TRIAL_END_DATE: "2026-08-28",
});

test("paper scheduler runs after 07:20 KST and retries only once", () => {
  const now = new Date("2026-08-10T00:00:00.000Z");
  assert.equal(decidePaperTradingSchedulerRun({ now, config, previous: null }).action, "run");
  assert.equal(decidePaperTradingSchedulerRun({ now, config, previous: { status: "failed", attempt: 1 } }).attempt, 2);
  assert.equal(decidePaperTradingSchedulerRun({ now, config, previous: { status: "failed", attempt: 2 } }).action, "retry_exhausted");
});

test("paper scheduler does not run before its KST window", () => {
  const now = new Date("2026-08-09T21:00:00.000Z");
  assert.equal(decidePaperTradingSchedulerRun({ now, config, previous: null }).action, "not_due");
});

test("three-week trial waits for August 10 and pauses after processing August 28", () => {
  assert.deepEqual(evaluatePaperTradingTrial("2026-08-07", config), { action: "waiting", shouldPauseAfterRun: false });
  assert.deepEqual(evaluatePaperTradingTrial("2026-08-10", config), { action: "run", shouldPauseAfterRun: false });
  assert.deepEqual(evaluatePaperTradingTrial("2026-08-28", config), { action: "run", shouldPauseAfterRun: true });
});
