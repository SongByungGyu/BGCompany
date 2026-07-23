export type OpenAIFinanceStatus = "connected" | "setup_required" | "forbidden" | "rate_limited" | "unavailable";

export type OpenAIFinanceBreakdown = {
  id: string;
  label: string;
  amountUsd: number;
};

export type OpenAIFinanceSummary = {
  status: OpenAIFinanceStatus;
  source: "OpenAI Costs API";
  message: string;
  collectedAt: string;
  periodStart: string;
  periodEnd: string;
  costs: {
    monthUsd: number | null;
    last7DaysUsd: number | null;
    todayUsd: number | null;
  };
  usage: {
    available: boolean;
    requests: number | null;
    inputTokens: number | null;
    cachedInputTokens: number | null;
    outputTokens: number | null;
  };
  lineItems: OpenAIFinanceBreakdown[];
  projects: OpenAIFinanceBreakdown[];
};

export type OpenAICostResult = {
  amount?: { value?: number | string | null; currency?: string | null } | null;
  line_item?: string | null;
  project_id?: string | null;
};

export type OpenAIUsageResult = {
  input_tokens?: number | string | null;
  input_cached_tokens?: number | string | null;
  output_tokens?: number | string | null;
  num_model_requests?: number | string | null;
  model?: string | null;
  project_id?: string | null;
};

export type OpenAITimeBucket<T> = {
  start_time?: number | null;
  end_time?: number | null;
  results?: T[] | null;
};
