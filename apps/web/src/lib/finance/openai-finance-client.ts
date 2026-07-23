import { aggregateOpenAIFinanceData, getOpenAIFinancePeriod } from "./openai-finance-rules";
import type {
  OpenAICostResult,
  OpenAIFinanceStatus,
  OpenAIFinanceSummary,
  OpenAITimeBucket,
  OpenAIUsageResult,
} from "./openai-finance-types";

const OPENAI_API_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_CACHE_MS = 5 * 60 * 1_000;
const MAX_PAGES = 8;

type Page<T> = {
  data?: OpenAITimeBucket<T>[];
  has_more?: boolean;
  next_page?: string | null;
};

type FetchLike = typeof fetch;

class OpenAIFinanceRequestError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "OpenAIFinanceRequestError";
  }
}

let cached: { expiresAt: number; value: OpenAIFinanceSummary } | null = null;
let inFlight: Promise<OpenAIFinanceSummary> | null = null;

function positiveInt(value: string | undefined, fallback: number) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function emptySummary(status: OpenAIFinanceStatus, message: string, now: Date): OpenAIFinanceSummary {
  const period = getOpenAIFinancePeriod(now);
  return {
    status,
    source: "OpenAI Costs API",
    message,
    collectedAt: now.toISOString(),
    periodStart: period.monthStart.toISOString(),
    periodEnd: period.end.toISOString(),
    costs: { monthUsd: null, last7DaysUsd: null, todayUsd: null },
    usage: { available: false, requests: null, inputTokens: null, cachedInputTokens: null, outputTokens: null },
    lineItems: [],
    projects: [],
  };
}

function projectFilters() {
  return (process.env.OPENAI_COST_PROJECT_IDS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

async function requestPages<T>(input: {
  path: string;
  adminKey: string;
  params: URLSearchParams;
  fetcher: FetchLike;
  timeoutMs: number;
}) {
  const buckets: OpenAITimeBucket<T>[] = [];
  let nextPage: string | null = null;
  for (let pageIndex = 0; pageIndex < MAX_PAGES; pageIndex += 1) {
    const params = new URLSearchParams(input.params);
    if (nextPage) params.set("page", nextPage);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), input.timeoutMs);
    let response: Response;
    try {
      response = await input.fetcher(`${OPENAI_API_BASE_URL}${input.path}?${params.toString()}`, {
        headers: { Authorization: `Bearer ${input.adminKey}`, "Content-Type": "application/json" },
        cache: "no-store",
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    if (!response.ok) throw new OpenAIFinanceRequestError(response.status, `OpenAI finance API returned ${response.status}`);
    const page = await response.json() as Page<T>;
    buckets.push(...(page.data ?? []));
    nextPage = page.has_more && page.next_page ? page.next_page : null;
    if (!nextPage) break;
  }
  return buckets;
}

export async function fetchOpenAIFinanceSummary(input: {
  adminKey?: string;
  now?: Date;
  fetcher?: FetchLike;
} = {}): Promise<OpenAIFinanceSummary> {
  const now = input.now ?? new Date();
  const adminKey = input.adminKey?.trim() || process.env.OPENAI_ADMIN_KEY?.trim() || "";
  if (!adminKey) {
    return emptySummary("setup_required", "OpenAI 조직 Admin Key를 연결하면 공식 청구 비용이 표시됩니다.", now);
  }

  const fetcher = input.fetcher ?? fetch;
  const timeoutMs = positiveInt(process.env.OPENAI_FINANCE_TIMEOUT_MS, DEFAULT_TIMEOUT_MS);
  const period = getOpenAIFinancePeriod(now);
  const common = new URLSearchParams({
    start_time: String(Math.floor(period.monthStart.getTime() / 1_000)),
    end_time: String(Math.floor(period.end.getTime() / 1_000)),
    bucket_width: "1d",
    limit: "31",
  });
  for (const projectId of projectFilters()) common.append("project_ids", projectId);

  try {
    const costParams = new URLSearchParams(common);
    costParams.append("group_by", "line_item");
    costParams.append("group_by", "project_id");
    const usageParams = new URLSearchParams(common);
    usageParams.append("group_by", "model");
    usageParams.append("group_by", "project_id");

    const costBuckets = await requestPages<OpenAICostResult>({
      path: "/organization/costs",
      adminKey,
      params: costParams,
      fetcher,
      timeoutMs,
    });
    let usageBuckets: OpenAITimeBucket<OpenAIUsageResult>[] = [];
    let usageAvailable = true;
    try {
      usageBuckets = await requestPages<OpenAIUsageResult>({
        path: "/organization/usage/completions",
        adminKey,
        params: usageParams,
        fetcher,
        timeoutMs,
      });
    } catch {
      usageAvailable = false;
    }
    const aggregated = aggregateOpenAIFinanceData({ costBuckets, usageBuckets, now });
    return {
      status: "connected",
      source: "OpenAI Costs API",
      message: usageAvailable
        ? "OpenAI 조직의 공식 비용·사용량 데이터를 조회했습니다."
        : "공식 비용은 연결됐지만 토큰 사용량은 현재 조회할 수 없습니다.",
      collectedAt: now.toISOString(),
      periodStart: aggregated.period.monthStart.toISOString(),
      periodEnd: aggregated.period.end.toISOString(),
      costs: aggregated.costs,
      usage: { available: usageAvailable, ...aggregated.usage },
      lineItems: aggregated.lineItems,
      projects: aggregated.projects,
    };
  } catch (error) {
    if (error instanceof OpenAIFinanceRequestError) {
      if (error.status === 401 || error.status === 403) {
        return emptySummary("forbidden", "현재 키에는 조직 비용 조회 권한이 없습니다. OpenAI Admin Key가 필요합니다.", now);
      }
      if (error.status === 429) return emptySummary("rate_limited", "OpenAI 비용 API 요청 한도에 도달해 잠시 후 다시 확인합니다.", now);
    }
    return emptySummary("unavailable", "OpenAI 비용 API에 연결할 수 없어 실제 금액을 표시하지 않습니다.", now);
  }
}

export async function getOpenAIFinanceSummary(options: { now?: Date; forceRefresh?: boolean } = {}) {
  const now = options.now ?? new Date();
  if (!options.forceRefresh && cached && cached.expiresAt > now.getTime()) return cached.value;
  if (!options.forceRefresh && inFlight) return inFlight;
  inFlight = fetchOpenAIFinanceSummary({ now }).then((value) => {
    cached = { expiresAt: now.getTime() + positiveInt(process.env.OPENAI_FINANCE_CACHE_MS, DEFAULT_CACHE_MS), value };
    return value;
  }).finally(() => {
    inFlight = null;
  });
  return inFlight;
}
