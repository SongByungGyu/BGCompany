import {
  asNumber,
  asRecord,
  asRecords,
  directionFromChange,
  makeSource,
  metricFromSource,
  parseDateTime,
} from "./market-data-utils";
import type {
  MarketSnapshot,
  MarketSnapshotDiagnostic,
  MarketSnapshotMetric,
  MarketSnapshotSource,
} from "./reference-types";

const FRED_API_ORIGIN = "https://api.stlouisfed.org";
const FRED_SERIES_PATH = "/fred/series/observations";

export const FRED_MARKET_SERIES = {
  "S&P 500": { key: "sp500", seriesId: "SP500" },
  NASDAQ: { key: "nasdaq", seriesId: "NASDAQCOM" },
  "Dow Jones": { key: "dow", seriesId: "DJIA" },
  "USD/KRW": { key: "fx", seriesId: "DEXKOUS" },
} as const;

type FredMarketLabel = keyof typeof FRED_MARKET_SERIES;
type FredMarketKey = (typeof FRED_MARKET_SERIES)[FredMarketLabel]["key"];

export type FredMarketResult = {
  status: MarketSnapshot["status"];
  us: NonNullable<MarketSnapshot["us"]>;
  sources: MarketSnapshotSource[];
  missingItems: string[];
  diagnostics: MarketSnapshotDiagnostic[];
};

function timeoutMs() {
  const parsed = Number.parseInt(process.env.FRED_TIMEOUT_MS ?? "10000", 10);
  return Number.isFinite(parsed) ? Math.max(1000, Math.min(parsed, 30000)) : 10000;
}

function maxAgeMinutes() {
  const parsed = Number.parseInt(process.env.FRED_MARKET_MAX_AGE_MINUTES ?? "5760", 10);
  return Number.isFinite(parsed) ? Math.max(1440, parsed) : 5760;
}

function waitForRateLimit() {
  const parsed = Number.parseInt(process.env.FRED_MARKET_REQUEST_INTERVAL_MS ?? "600", 10);
  const delayMs = Number.isFinite(parsed) ? Math.max(250, Math.min(parsed, 5000)) : 600;
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

function diagnostic(item: string, error: unknown): MarketSnapshotDiagnostic {
  const raw = error instanceof Error ? error.message : "FRED_MARKET_UNKNOWN_ERROR";
  const errorName = error instanceof Error ? error.name : "";
  const code = /^FRED_MARKET_(?:AUTH_FAILED|RATE_LIMITED|PARSE_FAILED|HTTP_\d{3})$/.test(raw)
    ? raw
    : errorName === "TimeoutError" || errorName === "AbortError"
      ? "FRED_MARKET_TIMEOUT"
      : error instanceof TypeError
        ? "FRED_MARKET_NETWORK_FAILED"
        : "FRED_MARKET_UNKNOWN_ERROR";
  const match = code.match(/HTTP_(\d{3})$/);
  return { provider: "fred", item, code, ...(match ? { httpStatus: Number(match[1]) } : {}) };
}

async function fredGet(seriesId: string, apiKey: string) {
  const url = new URL(FRED_SERIES_PATH, FRED_API_ORIGIN);
  url.searchParams.set("series_id", seriesId);
  url.searchParams.set("sort_order", "desc");
  url.searchParams.set("limit", "10");
  url.searchParams.set("api_key", apiKey);
  url.searchParams.set("file_type", "json");
  const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs()) });
  if (!response.ok) {
    const body = (await response.text()).slice(0, 800).toLowerCase();
    if (response.status === 401 || response.status === 403 || /api[_ -]?key|registered|registration/.test(body)) {
      throw new Error("FRED_MARKET_AUTH_FAILED");
    }
    if (response.status === 429) throw new Error("FRED_MARKET_RATE_LIMITED");
    throw new Error(`FRED_MARKET_HTTP_${response.status}`);
  }
  const body = asRecord(await response.json());
  if (!body) throw new Error("FRED_MARKET_PARSE_FAILED");
  return body;
}

export function parseFredMarketMetric(input: {
  body: Record<string, unknown>;
  label: FredMarketLabel;
  seriesId: string;
  collectedAt: string;
}): { metric: MarketSnapshotMetric; source: MarketSnapshotSource } | undefined {
  const observations = asRecords(input.body.observations)
    .map((row) => ({
      value: asNumber(row.value),
      asOf: parseDateTime(typeof row.date === "string" ? row.date : undefined),
    }))
    .filter((row): row is { value: number; asOf: string } => row.value !== undefined && Boolean(row.asOf));
  const latest = observations[0];
  if (!latest) return undefined;
  const previous = observations[1]?.value;
  const changePct = previous && previous !== 0
    ? ((latest.value - previous) / previous) * 100
    : undefined;
  const source = makeSource({
    provider: "fred",
    sourceName: `FRED · ${input.seriesId}`,
    url: `https://fred.stlouisfed.org/series/${encodeURIComponent(input.seriesId)}`,
    asOf: latest.asOf,
    collectedAt: input.collectedAt,
    maxAgeMinutes: maxAgeMinutes(),
  });
  return {
    metric: metricFromSource({
      label: input.label,
      value: latest.value,
      changePct,
      direction: directionFromChange(changePct),
      source,
    }),
    source,
  };
}

export async function collectFredMarketData(labels: readonly string[]): Promise<FredMarketResult> {
  const requested = Array.from(new Set(labels.filter((label): label is FredMarketLabel => label in FRED_MARKET_SERIES)));
  if (!requested.length) return { status: "ready", us: {}, sources: [], missingItems: [], diagnostics: [] };
  const apiKey = process.env.FRED_API_KEY?.trim();
  if (!apiKey) {
    return {
      status: "needs_credentials",
      us: {},
      sources: [],
      missingItems: requested,
      diagnostics: requested.map((item) => ({ provider: "fred", item, code: "FRED_MARKET_AUTH_FAILED" })),
    };
  }

  const collectedAt = new Date().toISOString();
  const us: NonNullable<MarketSnapshot["us"]> = {};
  const sources: MarketSnapshotSource[] = [];
  const missingItems: string[] = [];
  const diagnostics: MarketSnapshotDiagnostic[] = [];
  for (let index = 0; index < requested.length; index += 1) {
    const label = requested[index];
    const definition = FRED_MARKET_SERIES[label];
    const seriesId = process.env[`FRED_${definition.key.toUpperCase()}_SERIES_ID`]?.trim() || definition.seriesId;
    try {
      const body = await fredGet(seriesId, apiKey);
      const result = parseFredMarketMetric({ body, label, seriesId, collectedAt });
      if (result) {
        us[definition.key as FredMarketKey] = result.metric;
        sources.push(result.source);
        diagnostics.push({ provider: "fred", item: label, code: "FRED_MARKET_FALLBACK_USED", recovered: true });
      } else {
        missingItems.push(label);
        diagnostics.push({ provider: "fred", item: label, code: "FRED_MARKET_EMPTY_METRIC" });
      }
    } catch (error) {
      missingItems.push(label);
      diagnostics.push(diagnostic(label, error));
    }
    if (index < requested.length - 1) await waitForRateLimit();
  }
  return {
    status: missingItems.length ? (sources.length ? "needs_data" : "error") : "ready",
    us,
    sources,
    missingItems,
    diagnostics,
  };
}

export const FRED_MARKET_READ_ONLY_POLICY = {
  origin: FRED_API_ORIGIN,
  path: FRED_SERIES_PATH,
  series: Object.values(FRED_MARKET_SERIES).map((item) => item.seriesId),
  readOnly: true,
} as const;
