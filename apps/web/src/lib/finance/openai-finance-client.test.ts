import assert from "node:assert/strict";
import test from "node:test";
import { fetchOpenAIFinanceSummary } from "./openai-finance-client";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("공식 Costs와 Usage 응답만 실제 재정 요약으로 집계한다", async () => {
  const urls: string[] = [];
  const fetcher = (async (input: string | URL | Request) => {
    const url = String(input);
    urls.push(url);
    if (url.includes("/organization/costs")) {
      return jsonResponse({
        data: [{
          start_time: 1_785_335_400,
          results: [{ amount: { value: 1.25, currency: "usd" }, line_item: "Responses API", project_id: "proj_test" }],
        }],
        has_more: false,
      });
    }
    return jsonResponse({
      data: [{
        start_time: 1_785_335_400,
        results: [{ num_model_requests: 3, input_tokens: 1_000, input_cached_tokens: 200, output_tokens: 400 }],
      }],
      has_more: false,
    });
  }) as typeof fetch;

  const summary = await fetchOpenAIFinanceSummary({
    adminKey: "test-admin-key",
    now: new Date("2026-07-31T02:00:00.000Z"),
    fetcher,
  });

  assert.equal(summary.status, "connected");
  assert.equal(summary.costs.monthUsd, 1.25);
  assert.equal(summary.usage.requests, 3);
  assert.equal(summary.usage.inputTokens, 1_000);
  assert.equal(summary.usage.outputTokens, 400);
  assert.deepEqual(summary.lineItems, [{ id: "Responses API", label: "Responses API", amountUsd: 1.25 }]);
  assert.deepEqual(summary.projects, [{ id: "proj_test", label: "proj_test", amountUsd: 1.25 }]);
  assert.equal(urls.length, 2);
  assert.ok(urls.every((url) => !url.includes("test-admin-key")));
});

test("Admin Key 권한이 없으면 금액을 추정하지 않는다", async () => {
  const fetcher = (async () => jsonResponse({ error: "forbidden" }, 403)) as typeof fetch;
  const summary = await fetchOpenAIFinanceSummary({
    adminKey: "not-an-admin-key",
    now: new Date("2026-07-31T02:00:00.000Z"),
    fetcher,
  });

  assert.equal(summary.status, "forbidden");
  assert.equal(summary.costs.monthUsd, null);
  assert.equal(summary.usage.requests, null);
  assert.deepEqual(summary.lineItems, []);
  assert.deepEqual(summary.projects, []);
});
