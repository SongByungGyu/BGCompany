import "server-only";
import { getPortfolioPriceProvider, kisReadOnlyGet } from "./portfolio-price-provider";
import { buildPaperTradingSignal, type PaperDailyBar } from "./paper-trading-strategy";
import type { PaperTradingCycleInput } from "./paper-trading-types";

type UniverseAsset = { symbol: string; name: string; exchange: "NAS" | "NYS" | "AMS" };

const DEFAULT_UNIVERSE: UniverseAsset[] = [
  { symbol: "SPY", name: "SPDR S&P 500 ETF", exchange: "AMS" },
  { symbol: "QQQ", name: "Invesco QQQ", exchange: "NAS" },
  { symbol: "IWM", name: "iShares Russell 2000 ETF", exchange: "AMS" },
  { symbol: "DIA", name: "SPDR Dow Jones ETF", exchange: "AMS" },
  { symbol: "XLK", name: "Technology Select Sector SPDR", exchange: "AMS" },
  { symbol: "XLF", name: "Financial Select Sector SPDR", exchange: "AMS" },
  { symbol: "XLE", name: "Energy Select Sector SPDR", exchange: "AMS" },
  { symbol: "XLV", name: "Health Care Select Sector SPDR", exchange: "AMS" },
  { symbol: "SMH", name: "VanEck Semiconductor ETF", exchange: "NAS" },
  { symbol: "SOXX", name: "iShares Semiconductor ETF", exchange: "NAS" },
  { symbol: "AAPL", name: "Apple", exchange: "NAS" },
  { symbol: "MSFT", name: "Microsoft", exchange: "NAS" },
  { symbol: "NVDA", name: "NVIDIA", exchange: "NAS" },
  { symbol: "AMZN", name: "Amazon", exchange: "NAS" },
  { symbol: "GOOGL", name: "Alphabet", exchange: "NAS" },
  { symbol: "META", name: "Meta Platforms", exchange: "NAS" },
  { symbol: "AVGO", name: "Broadcom", exchange: "NAS" },
  { symbol: "TSLA", name: "Tesla", exchange: "NAS" },
  { symbol: "JPM", name: "JPMorgan Chase", exchange: "NYS" },
  { symbol: "XOM", name: "Exxon Mobil", exchange: "NYS" },
];

function asRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function numberValue(value: unknown) {
  const parsed = Number(typeof value === "string" ? value.replaceAll(",", "") : value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function dateValue(value: unknown) {
  const raw = typeof value === "string" ? value.replaceAll("-", "").trim() : "";
  return /^\d{8}$/.test(raw) ? `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}` : null;
}

function previousDate(value: string) {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10).replaceAll("-", "");
}

function intervalMs(env: NodeJS.ProcessEnv = process.env) {
  const parsed = Number.parseInt(env.PAPER_KIS_REQUEST_INTERVAL_MS ?? "650", 10);
  return Number.isFinite(parsed) ? Math.max(250, Math.min(parsed, 5_000)) : 650;
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function getPaperTradingUniverse(env: NodeJS.ProcessEnv = process.env): UniverseAsset[] {
  const raw = env.PAPER_US_UNIVERSE?.trim();
  if (!raw) return DEFAULT_UNIVERSE;
  const defaults = new Map(DEFAULT_UNIVERSE.map((asset) => [asset.symbol, asset]));
  const parsed = raw.split(",").map((entry) => {
    const [rawSymbol, rawExchange] = entry.trim().toUpperCase().split(":");
    const symbol = rawSymbol?.replace(/[^A-Z0-9.-]/g, "") ?? "";
    const exchange = (["NAS", "NYS", "AMS"].includes(rawExchange) ? rawExchange : defaults.get(symbol)?.exchange ?? "NAS") as UniverseAsset["exchange"];
    return symbol ? { symbol, exchange, name: defaults.get(symbol)?.name ?? symbol } : null;
  }).filter((asset): asset is UniverseAsset => Boolean(asset));
  const spy = parsed.find((asset) => asset.symbol === "SPY") ?? DEFAULT_UNIVERSE[0];
  return [spy, ...parsed.filter((asset) => asset.symbol !== "SPY")].slice(0, 40);
}

async function readPage(asset: UniverseAsset, before = "", attempt = 0): Promise<PaperDailyBar[]> {
  try {
    const response = await kisReadOnlyGet(
      "/uapi/overseas-price/v1/quotations/dailyprice",
      "HHDFS76240000",
      { AUTH: "", EXCD: asset.exchange, SYMB: asset.symbol, GUBN: "0", BYMD: before, MODP: "1" },
    );
    const body = asRecord(response.body);
    const rows = Array.isArray(body.output2) ? body.output2.map(asRecord) : [];
    const result: PaperDailyBar[] = [];
    for (const row of rows) {
      const marketDate = dateValue(row.xymd ?? row.stck_bsop_date ?? row.bsop_date);
      if (!marketDate) continue;
      const open = numberValue(row.open ?? row.ovrs_nmix_oprc);
      const high = numberValue(row.high ?? row.ovrs_nmix_hgpr);
      const low = numberValue(row.low ?? row.ovrs_nmix_lwpr);
      const close = numberValue(row.clos ?? row.last ?? row.ovrs_nmix_prpr);
      const volume = numberValue(row.tvol ?? row.acml_vol ?? row.ovrs_nmix_acml_vol);
      if (!(open > 0 && high >= open && high >= close && low > 0 && low <= open && low <= close && close > 0)) continue;
      result.push({ ...asset, marketDate, open, high, low, close, volume });
    }
    return result;
  } catch (error) {
    if (attempt < 1) {
      await wait(1_250);
      return readPage(asset, before, attempt + 1);
    }
    throw error;
  }
}

export async function fetchKisPaperDailyBars(asset: UniverseAsset): Promise<PaperDailyBar[]> {
  const first = await readPage(asset);
  await wait(intervalMs());
  const sorted = [...first].sort((left, right) => left.marketDate.localeCompare(right.marketDate));
  if (!sorted.length) throw new Error(`KIS_DAILY_PRICE_EMPTY:${asset.symbol}`);
  const second = sorted.length < 125 ? await readPage(asset, previousDate(sorted[0].marketDate)) : [];
  if (second.length) await wait(intervalMs());
  return Array.from(new Map([...second, ...first].map((bar) => [bar.marketDate, bar])).values())
    .sort((left, right) => left.marketDate.localeCompare(right.marketDate))
    .slice(-180);
}

export type AutomatedPaperCycle = {
  input: PaperTradingCycleInput;
  provider: "KIS_READ_ONLY";
  universeSize: number;
  loadedSymbols: number;
  candidateCount: number;
  signalDate: string | null;
  errors: string[];
};

export async function prepareAutomatedPaperCycle(strategyVersion: string): Promise<AutomatedPaperCycle> {
  const universe = getPaperTradingUniverse();
  const series = new Map<string, PaperDailyBar[]>();
  const errors: string[] = [];
  for (const asset of universe) {
    try {
      series.set(asset.symbol, await fetchKisPaperDailyBars(asset));
    } catch (error) {
      errors.push(`${asset.symbol}:${error instanceof Error ? error.message : "KIS_DAILY_PRICE_FAILED"}`.slice(0, 160));
    }
  }
  const benchmark = series.get("SPY");
  if (!benchmark?.length) throw new Error(`PAPER_BENCHMARK_UNAVAILABLE${errors.length ? `:${errors[0]}` : ""}`);
  const latestDate = benchmark.at(-1)!.marketDate;
  const previousDate = benchmark.at(-2)?.marketDate ?? null;
  if (!previousDate) throw new Error("PAPER_BENCHMARK_HISTORY_TOO_SHORT");
  const quotes = Array.from(series.values()).map((bars) => bars.find((bar) => bar.marketDate === latestDate)).filter((bar): bar is PaperDailyBar => Boolean(bar));
  const signals = Array.from(series.entries())
    .filter(([symbol]) => symbol !== "SPY")
    .map(([, bars]) => buildPaperTradingSignal({
      bars: bars.filter((bar) => bar.marketDate <= previousDate),
      benchmarkBars: benchmark.filter((bar) => bar.marketDate <= previousDate),
      strategyVersion,
    }))
    .filter((signal): signal is NonNullable<typeof signal> => Boolean(signal));
  const usdKrwQuote = await getPortfolioPriceProvider().getUsdKrw();
  const usdKrw = numberValue(usdKrwQuote?.currentPrice);
  if (!(usdKrw > 0)) throw new Error("PAPER_USD_KRW_UNAVAILABLE");
  const observedAt = new Date().toISOString();
  return {
    provider: "KIS_READ_ONLY",
    universeSize: universe.length,
    loadedSymbols: series.size,
    candidateCount: signals.length,
    signalDate: previousDate,
    errors,
    input: {
      marketDate: latestDate,
      observedAt,
      usdKrw,
      quotes: quotes.map((bar) => ({ symbol: bar.symbol, name: bar.name, marketDate: latestDate, observedAt, open: bar.open, high: bar.high, low: bar.low, close: bar.close })),
      signals,
    },
  };
}
