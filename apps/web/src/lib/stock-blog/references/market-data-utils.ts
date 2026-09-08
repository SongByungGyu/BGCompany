import type { MarketSnapshotFreshness, MarketSnapshotMetric, MarketSnapshotSource } from "./reference-types";
import { addIsoDays, getNyseMarketSession } from "../market-session-policy";

export function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return undefined;
  const normalized = value.replace(/,/g, "").trim();
  if (!normalized) return undefined;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

export function asRecords(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.map(asRecord).filter((item): item is Record<string, unknown> => Boolean(item));
  const record = asRecord(value);
  return record ? [record] : [];
}

export function parseDateTime(value?: string): string | undefined {
  if (!value) return undefined;
  if (/^\d{8}$/.test(value)) {
    return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T00:00:00.000Z`;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return `${value}T00:00:00.000Z`;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

export function freshnessFor(asOf: string, maxAgeMinutes: number, now = new Date()): Pick<MarketSnapshotSource, "freshness" | "ageMinutes"> {
  const timestamp = Date.parse(asOf);
  if (!Number.isFinite(timestamp)) return { freshness: "unknown", ageMinutes: -1 };
  const ageMinutes = Math.max(0, Math.floor((now.getTime() - timestamp) / 60000));
  if (ageMinutes <= maxAgeMinutes) return { freshness: "fresh", ageMinutes };
  if (ageMinutes <= maxAgeMinutes * 2) return { freshness: "stale", ageMinutes };
  return { freshness: "expired", ageMinutes };
}

function zonedParts(now: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value ?? "0");
  return {
    date: `${get("year")}-${String(get("month")).padStart(2, "0")}-${String(get("day")).padStart(2, "0")}`,
    hour: get("hour"),
  };
}

export function mostRecentCompletedNyseSessionDate(now = new Date()) {
  const ny = zonedParts(now, "America/New_York");
  let candidate = ny.hour >= 16 ? ny.date : addIsoDays(ny.date, -1);
  for (let offset = 0; offset < 10; offset += 1) {
    const session = getNyseMarketSession(candidate, {
      closedDates: process.env.STOCK_BLOG_US_CLOSED_DATES,
      openDates: process.env.STOCK_BLOG_US_OPEN_DATES,
    });
    if (session.state === "open") return candidate;
    candidate = addIsoDays(candidate, -1);
  }
  return null;
}

export function marketSessionAdjustedFreshness(
  asOf: string,
  maxAgeMinutes: number,
  now = new Date(),
  market?: "NYSE",
): Pick<MarketSnapshotSource, "freshness" | "ageMinutes"> {
  const ordinary = freshnessFor(asOf, maxAgeMinutes, now);
  if (ordinary.freshness === "fresh" || market !== "NYSE") return ordinary;
  const asOfDate = parseDateTime(asOf)?.slice(0, 10);
  const completedSession = mostRecentCompletedNyseSessionDate(now);
  return asOfDate && completedSession === asOfDate
    ? { freshness: "fresh", ageMinutes: ordinary.ageMinutes }
    : ordinary;
}

export function makeSource(
  input: Omit<MarketSnapshotSource, "freshness" | "ageMinutes">,
  now = new Date(),
  options: { market?: "NYSE" } = {},
): MarketSnapshotSource {
  return { ...input, ...marketSessionAdjustedFreshness(input.asOf, input.maxAgeMinutes, now, options.market) };
}

export function metricFromSource(input: Omit<MarketSnapshotMetric, "freshness" | "ageMinutes" | "collectedAt" | "maxAgeMinutes"> & {
  source: MarketSnapshotSource;
}): MarketSnapshotMetric {
  const { source, ...metric } = input;
  return {
    ...metric,
    asOf: metric.asOf ?? source.asOf,
    collectedAt: source.collectedAt,
    freshness: source.freshness,
    ageMinutes: source.ageMinutes,
    maxAgeMinutes: source.maxAgeMinutes,
    provider: source.provider,
    sourceName: metric.sourceName ?? source.sourceName,
    url: metric.url ?? source.url,
  };
}

export function aggregateFreshness(sources: MarketSnapshotSource[], checkedAt = new Date().toISOString()): MarketSnapshotFreshness {
  if (!sources.length) return { status: "unknown", checkedAt, staleItems: ["시장 데이터 출처"] };
  const staleItems = sources
    .filter((source) => source.freshness !== "fresh")
    .map((source) => `${source.sourceName}:${source.freshness}`);
  const status = sources.some((source) => source.freshness === "expired")
    ? "expired"
    : sources.some((source) => source.freshness === "stale")
      ? "stale"
      : sources.some((source) => source.freshness === "unknown")
        ? "unknown"
        : "fresh";
  const oldestAsOf = [...sources].sort((left, right) => Date.parse(left.asOf) - Date.parse(right.asOf))[0]?.asOf;
  return { status, checkedAt, oldestAsOf, staleItems };
}

export function directionFromChange(change?: number): MarketSnapshotMetric["direction"] {
  if (change === undefined) return undefined;
  if (change > 0) return "up";
  if (change < 0) return "down";
  return "flat";
}
