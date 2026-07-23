import assert from "node:assert/strict";
import test from "node:test";
import { aggregateOpenAIFinanceData, getOpenAIFinancePeriod } from "./openai-finance-rules";

test("KST 기준 월·오늘·최근 7일 실제 비용을 집계한다", () => {
  const now = new Date("2026-07-23T03:00:00.000Z");
  const result = aggregateOpenAIFinanceData({
    now,
    costBuckets: [
      { start_time: Date.parse("2026-07-01T00:00:00.000Z") / 1_000, results: [{ amount: { value: 1.25 }, line_item: "Responses API", project_id: "proj_a" }] },
      { start_time: Date.parse("2026-07-20T00:00:00.000Z") / 1_000, results: [{ amount: { value: "0.75" }, line_item: "Responses API", project_id: "proj_a" }] },
      { start_time: Date.parse("2026-07-23T00:00:00.000Z") / 1_000, results: [{ amount: { value: 0.5 }, line_item: "Image models", project_id: "proj_b" }] },
    ],
    usageBuckets: [{ results: [{ num_model_requests: 4, input_tokens: 1_000, input_cached_tokens: 300, output_tokens: 250 }] }],
  });

  assert.equal(result.costs.monthUsd, 2.5);
  assert.equal(result.costs.last7DaysUsd, 1.25);
  assert.equal(result.costs.todayUsd, 0.5);
  assert.deepEqual(result.lineItems.map((item) => [item.label, item.amountUsd]), [["Responses API", 2], ["Image models", 0.5]]);
  assert.equal(result.projects[0].amountUsd, 2);
  assert.deepEqual(result.usage, { requests: 4, inputTokens: 1_000, cachedInputTokens: 300, outputTokens: 250 });
});

test("KST 월 시작 시각을 UTC로 정확히 변환한다", () => {
  const period = getOpenAIFinancePeriod(new Date("2026-07-23T03:00:00.000Z"));
  assert.equal(period.monthStart.toISOString(), "2026-06-30T15:00:00.000Z");
  assert.equal(period.todayStart.toISOString(), "2026-07-22T15:00:00.000Z");
});
