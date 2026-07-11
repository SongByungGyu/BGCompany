import { asNumber, asRecord, asRecords, directionFromChange, makeSource, metricFromSource, parseDateTime } from "./market-data-utils";
import type { MarketSnapshot, MarketSnapshotSource } from "./reference-types";

const FRED_API_ORIGIN = "https://api.stlouisfed.org";
const FRED_ALLOWED_PATHS = new Set(["/fred/series/observations", "/fred/releases/dates"]);

export type FredResult = {
  status: MarketSnapshot["status"];
  macro?: MarketSnapshot["macro"];
  upcoming?: MarketSnapshot["upcoming"];
  sources: MarketSnapshotSource[];
  missingItems: string[];
  diagnostics?: FredDiagnostic[];
};

export type FredDiagnostic = {
  item: string;
  code: string;
  httpStatus?: number;
};

function maxAgeMinutes() {
  const parsed = Number.parseInt(process.env.FRED_MAX_AGE_MINUTES ?? "7200", 10);
  return Number.isFinite(parsed) ? Math.max(1440, parsed) : 7200;
}

function timeoutMs() {
  const parsed = Number.parseInt(process.env.FRED_TIMEOUT_MS ?? "10000", 10);
  return Number.isFinite(parsed) ? Math.max(1000, Math.min(parsed, 30000)) : 10000;
}

async function fredGet(path: string, params: Record<string, string>, apiKey: string) {
  if (!FRED_ALLOWED_PATHS.has(path)) throw new Error("FRED_QUERY_NOT_ALLOWLISTED");
  const url = new URL(path, FRED_API_ORIGIN);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  url.searchParams.set("api_key", apiKey);
  url.searchParams.set("file_type", "json");
  const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs()) });
  if (!response.ok) {
    const errorText = (await response.text()).slice(0, 800).toLowerCase();
    const authenticationFailure = response.status === 401
      || response.status === 403
      || (response.status === 400 && /api[_ -]?key|registered|registration/.test(errorText));
    if (authenticationFailure) throw new Error("FRED_AUTH_FAILED");
    if (response.status === 429) throw new Error("FRED_RATE_LIMITED");
    throw new Error(`FRED_HTTP_${response.status}`);
  }
  let decoded: unknown;
  try {
    decoded = await response.json();
  } catch {
    throw new Error("FRED_PARSE_FAILED");
  }
  const body = asRecord(decoded);
  if (!body) throw new Error("FRED_PARSE_FAILED");
  return body;
}

function safeDiagnostic(item: string, error: unknown): FredDiagnostic {
  const raw = error instanceof Error ? error.message : "FRED_UNKNOWN_ERROR";
  const code = /^FRED_(?:AUTH_FAILED|RATE_LIMITED|PARSE_FAILED|QUERY_NOT_ALLOWLISTED|HTTP_\d{3})$/.test(raw)
    ? raw
    : "FRED_UNKNOWN_ERROR";
  const match = code.match(/HTTP_(\d{3})$/);
  return { item, code, ...(match ? { httpStatus: Number(match[1]) } : {}) };
}

function latestObservation(body: Record<string, unknown>) {
  return asRecords(body.observations).find((row) => typeof row.value === "string" && row.value !== "." && asNumber(row.value) !== undefined);
}

function seriesSource(seriesId: string, asOf: string, collectedAt: string) {
  return makeSource({
    provider: "fred",
    sourceName: `FRED · ${seriesId}`,
    url: `https://fred.stlouisfed.org/series/${encodeURIComponent(seriesId)}`,
    asOf,
    collectedAt,
    maxAgeMinutes: maxAgeMinutes(),
  });
}

async function collectYield(seriesId: string, label: string, apiKey: string, collectedAt: string) {
  const body = await fredGet("/fred/series/observations", {
    series_id: seriesId,
    sort_order: "desc",
    limit: "10",
  }, apiKey);
  const observation = latestObservation(body);
  const value = asNumber(observation?.value);
  const asOf = parseDateTime(typeof observation?.date === "string" ? observation.date : undefined);
  if (value === undefined || !asOf) return undefined;
  const dataSource = seriesSource(seriesId, asOf, collectedAt);
  return {
    metric: metricFromSource({ label, value, direction: directionFromChange(value), source: dataSource }),
    source: dataSource,
  };
}

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

async function collectReleaseCalendar(apiKey: string, collectedAt: string) {
  const start = new Date();
  const end = new Date(start.getTime() + 14 * 86400000);
  const body = await fredGet("/fred/releases/dates", {
    realtime_start: isoDate(start),
    realtime_end: isoDate(end),
    include_release_dates_with_no_data: "true",
    limit: "1000",
    sort_order: "asc",
  }, apiKey);
  const events = asRecords(body.release_dates)
    .map((row) => {
      const date = typeof row.date === "string" ? row.date : undefined;
      const event = typeof row.release_name === "string" ? row.release_name.trim() : undefined;
      const releaseId = typeof row.release_id === "number" || typeof row.release_id === "string" ? String(row.release_id) : undefined;
      if (!date || !event) return undefined;
      return {
        date,
        event,
        market: "US",
        sourceName: "FRED Economic Release Calendar",
        url: releaseId ? `https://fred.stlouisfed.org/release?rid=${encodeURIComponent(releaseId)}` : "https://fred.stlouisfed.org/releases/calendar",
      };
    })
    .filter((event): event is NonNullable<typeof event> => Boolean(event))
    .slice(0, 30);
  const dataSource = makeSource({
    provider: "fred",
    sourceName: "FRED Economic Release Calendar",
    url: "https://fred.stlouisfed.org/releases/calendar",
    asOf: collectedAt,
    collectedAt,
    maxAgeMinutes: 1440,
  });
  return { events, source: dataSource };
}

function waitForRateLimit() {
  return new Promise((resolve) => setTimeout(resolve, 550));
}

export async function collectFredMacroData(): Promise<FredResult> {
  const apiKey = process.env.FRED_API_KEY?.trim();
  if (!apiKey) return { status: "needs_credentials", sources: [], missingItems: ["FRED_API_KEY"] };
  const collectedAt = new Date().toISOString();
  const sources: MarketSnapshotSource[] = [];
  const missingItems: string[] = [];
  const macro: NonNullable<MarketSnapshot["macro"]> = {};
  try {
    const twoYearId = process.env.FRED_US_2Y_SERIES_ID?.trim() || "DGS2";
    const tenYearId = process.env.FRED_US_10Y_SERIES_ID?.trim() || "DGS10";
    const twoYear = await collectYield(twoYearId, "미국 2년물 국채금리", apiKey, collectedAt);
    await waitForRateLimit();
    const tenYear = await collectYield(tenYearId, "미국 10년물 국채금리", apiKey, collectedAt);
    await waitForRateLimit();
    const calendar = await collectReleaseCalendar(apiKey, collectedAt);

    if (twoYear) { macro.us2Year = twoYear.metric; sources.push(twoYear.source); } else missingItems.push("미국 2년물 국채금리");
    if (tenYear) { macro.us10Year = tenYear.metric; sources.push(tenYear.source); } else missingItems.push("미국 10년물 국채금리");
    if (twoYear && tenYear && typeof twoYear.metric.value === "number" && typeof tenYear.metric.value === "number") {
      const spread = tenYear.metric.value - twoYear.metric.value;
      macro.yieldSpread10Y2Y = metricFromSource({ label: "미국 10Y-2Y 금리차", value: Number(spread.toFixed(3)), direction: directionFromChange(spread), source: tenYear.source });
    }
    sources.push(calendar.source);
    if (!calendar.events.length) missingItems.push("향후 14일 미국 경제지표 발표 일정");
    return {
      status: missingItems.length ? "needs_data" : "ready",
      macro,
      upcoming: calendar.events,
      sources,
      missingItems,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "FRED_ERROR";
    return {
      status: message === "FRED_AUTH_FAILED" ? "needs_credentials" : "error",
      macro,
      sources,
      diagnostics: [safeDiagnostic("FRED macro provider", error)],
      missingItems: message === "FRED_AUTH_FAILED" ? ["유효한 FRED_API_KEY"] : ["FRED 국채금리/경제 일정 응답"],
    };
  }
}

export const FRED_READ_ONLY_POLICY = {
  origin: FRED_API_ORIGIN,
  allowedPaths: Array.from(FRED_ALLOWED_PATHS),
  series: ["DGS2", "DGS10"],
} as const;
