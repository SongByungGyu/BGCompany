import fs from "node:fs/promises";
import path from "node:path";
import { collectFredMacroData, type FredResult } from "./fred-macro-provider";
import { collectKisMarketData, type KisResult } from "./kis-market-data-provider";
import { canUseFredDegradedMode, FRED_DEGRADED_DISCLOSURE, FRED_DEGRADED_MODE } from "./fred-degraded-policy";
import { aggregateFreshness } from "./market-data-utils";
import { supplementFredMacroData } from "./official-us-macro-provider";
import type { MarketSnapshot, ReferenceSearchInput } from "./reference-types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function marketDate() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

function parseSnapshot(value: unknown): MarketSnapshot | null {
  if (!isRecord(value)) return null;
  const snapshot = value as unknown as MarketSnapshot;
  if (!snapshot.marketDate || !snapshot.korea) return null;
  const provider = snapshot.provider === "kis-fred" || snapshot.provider === "configured-api" ? snapshot.provider : "manual";
  return {
    ...snapshot,
    provider,
    status: snapshot.status === "ready" ? "ready" : "needs_data",
    collectedAt: snapshot.collectedAt || new Date().toISOString(),
    dataQuality: snapshot.dataQuality === "verified" ? "verified" : "partial",
    freshness: snapshot.freshness ?? aggregateFreshness(snapshot.sources ?? []),
    sources: snapshot.sources ?? [],
    missingItems: Array.isArray(snapshot.missingItems) ? snapshot.missingItems : [],
  };
}

function emptySnapshot(provider: MarketSnapshot["provider"], status: MarketSnapshot["status"], missingItems: string[]): MarketSnapshot {
  const collectedAt = new Date().toISOString();
  return {
    provider,
    status,
    marketDate: marketDate(),
    collectedAt,
    dataQuality: "missing",
    freshness: { status: "unknown", checkedAt: collectedAt, staleItems: ["시장 데이터 출처"] },
    sources: [],
    missingItems,
  };
}

async function readManualSnapshot() {
  const inline = process.env.STOCK_MARKET_SNAPSHOT_JSON?.trim();
  if (inline) {
    try { return parseSnapshot(JSON.parse(inline)); } catch { return null; }
  }
  const configured = process.env.STOCK_MARKET_SNAPSHOT_PATH?.trim() || "config/stock-references/market-snapshot.json";
  const filePath = path.isAbsolute(configured)
    ? configured
    : path.resolve(/* turbopackIgnore: true */ process.cwd(), configured);
  try { return parseSnapshot(JSON.parse(await fs.readFile(filePath, "utf8"))); } catch { return null; }
}

async function readConfiguredApiSnapshot() {
  const endpoint = process.env.STOCK_MARKET_DATA_API_URL?.trim();
  const apiKey = process.env.STOCK_MARKET_DATA_API_KEY?.trim();
  if (!endpoint || !apiKey) return emptySnapshot("configured-api", "needs_credentials", ["STOCK_MARKET_DATA_API_URL", "STOCK_MARKET_DATA_API_KEY"]);
  let url: URL;
  try { url = new URL(endpoint); } catch { return emptySnapshot("configured-api", "needs_data", ["올바른 STOCK_MARKET_DATA_API_URL"]); }
  if (url.protocol !== "https:") return emptySnapshot("configured-api", "needs_data", ["HTTPS 시장 데이터 API URL"]);
  try {
    const response = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(10000) });
    if (!response.ok) return emptySnapshot("configured-api", "error", [`시장 데이터 API HTTP ${response.status}`]);
    return parseSnapshot(await response.json()) ?? emptySnapshot("configured-api", "needs_data", ["유효한 MarketSnapshot 응답"]);
  } catch {
    return emptySnapshot("configured-api", "error", ["시장 데이터 API 응답"]);
  }
}

function requiredAutomaticItems(snapshot: Pick<MarketSnapshot, "korea" | "us" | "macro" | "upcoming">) {
  const missing: string[] = [];
  if (!snapshot.korea?.kospi) missing.push("KOSPI");
  if (!snapshot.korea?.kosdaq) missing.push("KOSDAQ");
  if (!snapshot.korea?.investorFlows?.length) missing.push("투자자별 매매동향");
  if (!snapshot.korea?.strongSectors?.length || !snapshot.korea?.weakSectors?.length) missing.push("국내 강세/약세 업종");
  if (!snapshot.us?.sp500) missing.push("S&P 500");
  if (!snapshot.us?.nasdaq) missing.push("NASDAQ");
  if (!snapshot.us?.dow) missing.push("Dow Jones");
  if (!snapshot.us?.fx) missing.push("USD/KRW");
  if (!snapshot.macro?.us2Year) missing.push("미국 2년물 국채금리");
  if (!snapshot.macro?.us10Year) missing.push("미국 10년물 국채금리");
  if (!snapshot.upcoming?.length) missing.push("향후 미국 경제지표 발표 일정");
  return missing;
}

export function buildAutomaticMarketSnapshot(kis: KisResult, fred: FredResult, collectedAt = new Date().toISOString()): MarketSnapshot {
  const sources = [...kis.sources, ...fred.sources];
  const freshness = aggregateFreshness(sources, collectedAt);
  const kisFreshness = aggregateFreshness(kis.sources, collectedAt);
  const us = { ...kis.us, treasuryYield: fred.macro?.us10Year };
  const requiredMissing = requiredAutomaticItems({ korea: kis.korea, us, macro: fred.macro, upcoming: fred.upcoming });
  const missingItems = Array.from(new Set([...kis.missingItems, ...fred.missingItems, ...requiredMissing, ...freshness.staleItems]));
  const fredDegraded = canUseFredDegradedMode(kis, fred, kisFreshness);
  if (fredDegraded) {
    return {
      provider: "kis-fred",
      status: "ready",
      marketDate: marketDate(),
      collectedAt,
      dataQuality: "partial",
      degradedMode: FRED_DEGRADED_MODE,
      degradedProviders: ["fred"],
      degradedReason: fred.missingItems.join(", ") || "FRED/공식 미국 거시지표 조회 지연",
      disclosures: [FRED_DEGRADED_DISCLOSURE],
      freshness: kisFreshness,
      sources,
      korea: kis.korea,
      us,
      macro: fred.macro,
      upcoming: fred.upcoming,
      missingItems,
    };
  }
  const status: MarketSnapshot["status"] = kis.status === "needs_credentials" || fred.status === "needs_credentials"
    ? "needs_credentials"
    : kis.status === "error" || fred.status === "error"
      ? "error"
      : missingItems.length || freshness.status !== "fresh"
        ? "needs_data"
        : "ready";
  return {
    provider: "kis-fred",
    status,
    marketDate: marketDate(),
    collectedAt,
    dataQuality: status === "ready" ? "verified" : sources.length ? "partial" : "missing",
    freshness,
    sources,
    korea: kis.korea,
    us,
    macro: fred.macro,
    upcoming: fred.upcoming,
    missingItems,
  };
}

async function collectAutomaticSnapshot(input: ReferenceSearchInput): Promise<MarketSnapshot> {
  const [kis, primaryFred] = await Promise.all([collectKisMarketData(input), collectFredMacroData()]);
  const fred = primaryFred.status === "ready"
    ? primaryFred
    : await supplementFredMacroData(primaryFred);
  return buildAutomaticMarketSnapshot(kis, fred);
}

export async function collectMarketSnapshot(input: ReferenceSearchInput): Promise<MarketSnapshot> {
  const provider = process.env.STOCK_MARKET_DATA_PROVIDER?.trim() || "kis-fred";
  if (provider === "manual") {
    return await readManualSnapshot() ?? emptySnapshot("manual", "needs_data", ["비상용 Manual MarketSnapshot"]);
  }
  if (provider === "api" || provider === "configured-api") return readConfiguredApiSnapshot();

  const automatic = await collectAutomaticSnapshot(input);
  if (automatic.status === "ready" || process.env.STOCK_MARKET_DATA_ALLOW_MANUAL_FALLBACK !== "true") return automatic;
  const fallback = await readManualSnapshot();
  if (!fallback) return automatic;
  return {
    ...fallback,
    provider: "manual",
    fallbackUsed: true,
    missingItems: Array.from(new Set([...(fallback.missingItems ?? []), `자동 provider 실패: ${automatic.status}`])),
  };
}
