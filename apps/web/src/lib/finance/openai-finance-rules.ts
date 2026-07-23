import type {
  OpenAICostResult,
  OpenAIFinanceBreakdown,
  OpenAITimeBucket,
  OpenAIUsageResult,
} from "./openai-finance-types";

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

function numberValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function kstBoundaryUtc(now: Date, dayOfMonth: number) {
  const shifted = new Date(now.getTime() + KST_OFFSET_MS);
  return new Date(Date.UTC(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth(),
    dayOfMonth,
    0,
    0,
    0,
    0,
  ) - KST_OFFSET_MS);
}

export function getOpenAIFinancePeriod(now = new Date()) {
  const todayStart = kstBoundaryUtc(now, new Date(now.getTime() + KST_OFFSET_MS).getUTCDate());
  const monthStart = kstBoundaryUtc(now, 1);
  const last7DaysStart = new Date(Math.max(monthStart.getTime(), todayStart.getTime() - (6 * DAY_MS)));
  return { monthStart, last7DaysStart, todayStart, end: new Date(now.getTime() + 1_000) };
}

function aggregateBreakdown(entries: Array<{ id: string; label: string; amountUsd: number }>): OpenAIFinanceBreakdown[] {
  const totals = new Map<string, { label: string; amountUsd: number }>();
  for (const entry of entries) {
    const current = totals.get(entry.id) ?? { label: entry.label, amountUsd: 0 };
    current.amountUsd += entry.amountUsd;
    totals.set(entry.id, current);
  }
  return Array.from(totals, ([id, value]) => ({ id, label: value.label, amountUsd: value.amountUsd }))
    .filter((entry) => entry.amountUsd > 0)
    .sort((a, b) => b.amountUsd - a.amountUsd);
}

export function aggregateOpenAIFinanceData(input: {
  costBuckets: OpenAITimeBucket<OpenAICostResult>[];
  usageBuckets: OpenAITimeBucket<OpenAIUsageResult>[];
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const period = getOpenAIFinancePeriod(now);
  let monthUsd = 0;
  let last7DaysUsd = 0;
  let todayUsd = 0;
  const lineItems: Array<{ id: string; label: string; amountUsd: number }> = [];
  const projects: Array<{ id: string; label: string; amountUsd: number }> = [];

  for (const bucket of input.costBuckets) {
    const bucketStartMs = numberValue(bucket.start_time) * 1_000;
    for (const result of bucket.results ?? []) {
      const amountUsd = Math.max(0, numberValue(result.amount?.value));
      monthUsd += amountUsd;
      if (bucketStartMs >= period.last7DaysStart.getTime()) last7DaysUsd += amountUsd;
      if (bucketStartMs >= period.todayStart.getTime()) todayUsd += amountUsd;
      const lineItem = result.line_item?.trim() || "기타 OpenAI 비용";
      const projectId = result.project_id?.trim() || "organization";
      lineItems.push({ id: lineItem, label: lineItem, amountUsd });
      projects.push({ id: projectId, label: projectId === "organization" ? "조직 공통" : projectId, amountUsd });
    }
  }

  let requests = 0;
  let inputTokens = 0;
  let cachedInputTokens = 0;
  let outputTokens = 0;
  for (const bucket of input.usageBuckets) {
    for (const result of bucket.results ?? []) {
      requests += Math.max(0, numberValue(result.num_model_requests));
      inputTokens += Math.max(0, numberValue(result.input_tokens));
      cachedInputTokens += Math.max(0, numberValue(result.input_cached_tokens));
      outputTokens += Math.max(0, numberValue(result.output_tokens));
    }
  }

  return {
    period,
    costs: { monthUsd, last7DaysUsd, todayUsd },
    usage: { requests, inputTokens, cachedInputTokens, outputTokens },
    lineItems: aggregateBreakdown(lineItems),
    projects: aggregateBreakdown(projects),
  };
}
