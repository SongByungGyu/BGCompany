import fs from "node:fs/promises";
import path from "node:path";
import type { MarketSnapshot, ReferenceSearchInput } from "./reference-types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseSnapshot(value: unknown): MarketSnapshot | null {
  if (!isRecord(value)) return null;
  const snapshot = value as unknown as MarketSnapshot;
  if (!snapshot.marketDate || !snapshot.korea) return null;
  return {
    ...snapshot,
    provider: snapshot.provider === "configured-api" ? "configured-api" : "manual",
    status: snapshot.status === "ready" ? "ready" : "needs_data",
    collectedAt: snapshot.collectedAt || new Date().toISOString(),
    dataQuality: snapshot.dataQuality === "verified" ? "verified" : "partial",
    missingItems: Array.isArray(snapshot.missingItems) ? snapshot.missingItems : [],
  };
}

function emptySnapshot(status: MarketSnapshot["status"], missingItems: string[]): MarketSnapshot {
  return {
    provider: process.env.STOCK_MARKET_DATA_PROVIDER === "api" ? "configured-api" : "manual",
    status,
    marketDate: new Date().toISOString().slice(0, 10),
    collectedAt: new Date().toISOString(),
    dataQuality: "missing",
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
  if (!endpoint || !apiKey) return emptySnapshot("needs_credentials", ["STOCK_MARKET_DATA_API_URL", "STOCK_MARKET_DATA_API_KEY"]);
  let url: URL;
  try { url = new URL(endpoint); } catch { return emptySnapshot("needs_data", ["올바른 STOCK_MARKET_DATA_API_URL"]); }
  if (url.protocol !== "https:") return emptySnapshot("needs_data", ["HTTPS 시장 데이터 API URL"]);
  try {
    const response = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(10000) });
    if (!response.ok) return emptySnapshot("error", [`시장 데이터 API HTTP ${response.status}`]);
    return parseSnapshot(await response.json()) ?? emptySnapshot("needs_data", ["유효한 MarketSnapshot 응답"]);
  } catch {
    return emptySnapshot("error", ["시장 데이터 API 응답"]);
  }
}

export async function collectMarketSnapshot(input: ReferenceSearchInput): Promise<MarketSnapshot> {
  void input;
  const provider = process.env.STOCK_MARKET_DATA_PROVIDER?.trim() || "manual";
  const snapshot = provider === "api" ? await readConfiguredApiSnapshot() : await readManualSnapshot();
  return snapshot ?? emptySnapshot("needs_data", ["KOSPI/KOSDAQ 주간 흐름", "투자자 수급", "강세/약세 업종", "미국 주요 지수", "다음 주 일정"]);
}
