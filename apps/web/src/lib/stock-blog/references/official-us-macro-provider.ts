import { directionFromChange, makeSource, metricFromSource, parseDateTime } from "./market-data-utils";
import type { FredDiagnostic, FredResult } from "./fred-macro-provider";
import type { MarketSnapshot, MarketSnapshotSource } from "./reference-types";

const TREASURY_FEED_ORIGIN = "https://home.treasury.gov";
const TREASURY_FEED_PATH = "/resource-center/data-chart-center/interest-rates/pages/xml";
const BLS_CALENDAR_URL = "https://www.bls.gov/schedule/news_release/bls.ics";
const BEA_CALENDAR_URL = "https://www.bea.gov/news/schedule";
const FOMC_CALENDAR_URL = "https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm";

type CalendarEvent = NonNullable<MarketSnapshot["upcoming"]>[number];

function timeoutMs() {
  const parsed = Number.parseInt(process.env.OFFICIAL_US_DATA_TIMEOUT_MS ?? "12000", 10);
  return Number.isFinite(parsed) ? Math.max(1000, Math.min(parsed, 30000)) : 12000;
}

async function fetchText(url: URL | string, accept: string) {
  const response = await fetch(url, {
    headers: {
      Accept: accept,
      "User-Agent": "BGCompany-MarketSnapshot/1.0 (+https://bgcompanyoffice.cloud)",
    },
    signal: AbortSignal.timeout(timeoutMs()),
  });
  if (response.status === 429) throw new Error("OFFICIAL_US_RATE_LIMITED");
  if (!response.ok) throw new Error(`OFFICIAL_US_HTTP_${response.status}`);
  return response.text();
}

function decodeXml(value: string) {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .trim();
}

function xmlField(entry: string, field: string) {
  const match = entry.match(new RegExp(`<d:${field}[^>]*>([\\s\\S]*?)<\\/d:${field}>`, "i"));
  if (!match) return undefined;
  return decodeXml(match[1]).replace(/<[^>]+>/g, "").trim() || undefined;
}

function treasuryMaxAgeMinutes() {
  const parsed = Number.parseInt(process.env.US_TREASURY_MAX_AGE_MINUTES ?? "7200", 10);
  return Number.isFinite(parsed) ? Math.max(1440, parsed) : 7200;
}

async function collectTreasuryYields(collectedAt: string) {
  const url = new URL(TREASURY_FEED_PATH, TREASURY_FEED_ORIGIN);
  url.searchParams.set("data", "daily_treasury_yield_curve");
  url.searchParams.set("field_tdr_date_value_month", collectedAt.slice(0, 7).replace("-", ""));
  const xml = await fetchText(url, "application/xml,text/xml;q=0.9,*/*;q=0.1");
  const entries = Array.from(xml.matchAll(/<entry\b[\s\S]*?<\/entry>/gi), (match) => match[0]);
  const observations = entries
    .map((entry) => ({
      date: xmlField(entry, "NEW_DATE"),
      twoYear: Number(xmlField(entry, "BC_2YEAR")),
      tenYear: Number(xmlField(entry, "BC_10YEAR")),
    }))
    .filter((item) => item.date && (Number.isFinite(item.twoYear) || Number.isFinite(item.tenYear)))
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const latest = observations[0];
  const asOf = parseDateTime(latest?.date);
  if (!latest || !asOf) throw new Error("OFFICIAL_US_TREASURY_PARSE_FAILED");
  const source = makeSource({
    provider: "us-treasury",
    sourceName: "U.S. Treasury Daily Par Yield Curve Rates",
    url: "https://home.treasury.gov/resource-center/data-chart-center/interest-rates/TextView?type=daily_treasury_yield_curve",
    asOf,
    collectedAt,
    maxAgeMinutes: treasuryMaxAgeMinutes(),
  });
  const macro: NonNullable<MarketSnapshot["macro"]> = {};
  if (Number.isFinite(latest.twoYear)) {
    macro.us2Year = metricFromSource({ label: "미국 2년물 국채금리", value: latest.twoYear, direction: directionFromChange(latest.twoYear), source });
  }
  if (Number.isFinite(latest.tenYear)) {
    macro.us10Year = metricFromSource({ label: "미국 10년물 국채금리", value: latest.tenYear, direction: directionFromChange(latest.tenYear), source });
  }
  if (macro.us2Year && macro.us10Year && typeof macro.us2Year.value === "number" && typeof macro.us10Year.value === "number") {
    const spread = macro.us10Year.value - macro.us2Year.value;
    macro.yieldSpread10Y2Y = metricFromSource({ label: "미국 10Y-2Y 금리차", value: Number(spread.toFixed(3)), direction: directionFromChange(spread), source });
  }
  return { macro, source };
}

function unescapeIcs(value: string) {
  return value.replace(/\\n/gi, " ").replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\\\/g, "\\").trim();
}

function icsValue(block: string, key: string) {
  const match = block.match(new RegExp(`^${key}(?:;[^:]*)?:(.+)$`, "mi"));
  return match ? unescapeIcs(match[1]) : undefined;
}

function compactDate(value?: string) {
  if (!value) return undefined;
  const match = value.match(/^(\d{4})(\d{2})(\d{2})/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : undefined;
}

async function collectBlsCalendar(collectedAt: string) {
  const raw = await fetchText(BLS_CALENDAR_URL, "text/calendar,text/plain;q=0.9,*/*;q=0.1");
  const ics = raw.replace(/\r?\n[ \t]/g, "");
  const start = new Date(`${collectedAt.slice(0, 10)}T00:00:00Z`).getTime();
  const end = start + 14 * 86400000;
  const events = ics.split("BEGIN:VEVENT").slice(1).map((block): CalendarEvent | undefined => {
    const date = compactDate(icsValue(block, "DTSTART"));
    const event = icsValue(block, "SUMMARY");
    if (!date || !event) return undefined;
    const timestamp = new Date(`${date}T00:00:00Z`).getTime();
    if (timestamp < start || timestamp > end) return undefined;
    return {
      date,
      event,
      market: "US",
      sourceName: "U.S. Bureau of Labor Statistics",
      url: icsValue(block, "URL") || "https://www.bls.gov/schedule/news_release/",
    };
  }).filter((event): event is CalendarEvent => Boolean(event));
  const source = makeSource({
    provider: "bls",
    sourceName: "U.S. Bureau of Labor Statistics Release Calendar",
    url: BLS_CALENDAR_URL,
    asOf: collectedAt,
    collectedAt,
    maxAgeMinutes: 1440,
  });
  return { events, source };
}

function diagnostic(item: string, error: unknown): FredDiagnostic {
  const raw = error instanceof Error ? error.message : "OFFICIAL_US_UNKNOWN_ERROR";
  const errorName = error instanceof Error ? error.name : "";
  const code = /^OFFICIAL_US_[A-Z0-9_]+$/.test(raw)
    ? raw
    : errorName === "TimeoutError" || errorName === "AbortError"
      ? "OFFICIAL_US_TIMEOUT"
      : error instanceof TypeError
        ? "OFFICIAL_US_NETWORK_FAILED"
        : "OFFICIAL_US_UNKNOWN_ERROR";
  const match = code.match(/HTTP_(\d{3})$/);
  return { item, code, ...(match ? { httpStatus: Number(match[1]) } : {}) };
}

function dedupeEvents(events: CalendarEvent[]) {
  const seen = new Set<string>();
  return events.filter((event) => {
    const key = `${event.date}|${event.event}`.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 30);
}

export async function supplementFredMacroData(primary: FredResult): Promise<FredResult> {
  const collectedAt = new Date().toISOString();
  const macro: NonNullable<MarketSnapshot["macro"]> = { ...(primary.macro ?? {}) };
  const sources: MarketSnapshotSource[] = [...primary.sources];
  const diagnostics: FredDiagnostic[] = [...(primary.diagnostics ?? [])];
  let upcoming = [...(primary.upcoming ?? [])];

  if (!macro.us2Year || !macro.us10Year) {
    try {
      const treasury = await collectTreasuryYields(collectedAt);
      if (!macro.us2Year && treasury.macro.us2Year) macro.us2Year = treasury.macro.us2Year;
      if (!macro.us10Year && treasury.macro.us10Year) macro.us10Year = treasury.macro.us10Year;
      if (!macro.yieldSpread10Y2Y && treasury.macro.yieldSpread10Y2Y) macro.yieldSpread10Y2Y = treasury.macro.yieldSpread10Y2Y;
      sources.push(treasury.source);
    } catch (error) {
      diagnostics.push(diagnostic("U.S. Treasury yield curve", error));
    }
  }

  if (!upcoming.length) {
    try {
      const bls = await collectBlsCalendar(collectedAt);
      upcoming = dedupeEvents([...upcoming, ...bls.events]);
      sources.push(bls.source);
    } catch (error) {
      diagnostics.push(diagnostic("BLS release calendar", error));
    }
  }

  const missingItems: string[] = [];
  if (!macro.us2Year) missingItems.push("미국 2년물 국채금리");
  if (!macro.us10Year) missingItems.push("미국 10년물 국채금리");
  if (!upcoming.length) missingItems.push("향후 미국 경제지표 발표 일정");
  const status: FredResult["status"] = missingItems.length ? (sources.length ? "needs_data" : primary.status) : "ready";
  return { status, macro, upcoming, sources, missingItems, diagnostics };
}

export const OFFICIAL_US_FALLBACK_POLICY = {
  treasury: `${TREASURY_FEED_ORIGIN}${TREASURY_FEED_PATH}`,
  calendar: [BLS_CALENDAR_URL, BEA_CALENDAR_URL, FOMC_CALENDAR_URL],
  readOnly: true,
} as const;
