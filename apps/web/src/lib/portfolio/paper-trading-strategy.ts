import type { PaperTradingSignalInput } from "./paper-trading-types";
import type { PaperTradingRotationTarget } from "./paper-trading-types";

export type PaperDailyBar = {
  symbol: string;
  name: string;
  exchange: string;
  marketDate: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

type IndicatorSnapshot = {
  ema20: number;
  ema50: number;
  ema100: number;
  rsi14: number;
  atr14: number;
  adx14: number;
  plusDi14: number;
  minusDi14: number;
  macdHistogram: number;
  relativeVolume20: number;
  relativeStrength20: number;
  priorHigh20: number;
  recentLow10: number;
};

function average(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function ema(values: number[], period: number) {
  if (!values.length) return 0;
  const alpha = 2 / (period + 1);
  return values.slice(1).reduce((result, value) => value * alpha + result * (1 - alpha), values[0]);
}

function rsi(values: number[], period = 14) {
  if (values.length <= period) return 50;
  const changes = values.slice(1).map((value, index) => value - values[index]);
  let gains = average(changes.slice(0, period).map((value) => Math.max(value, 0)));
  let losses = average(changes.slice(0, period).map((value) => Math.max(-value, 0)));
  for (const change of changes.slice(period)) {
    gains = (gains * (period - 1) + Math.max(change, 0)) / period;
    losses = (losses * (period - 1) + Math.max(-change, 0)) / period;
  }
  if (losses === 0) return gains > 0 ? 100 : 50;
  return 100 - 100 / (1 + gains / losses);
}

function directionalMovement(bars: PaperDailyBar[], period = 14) {
  if (bars.length <= period + 1) return { atr: 0, adx: 0, plusDi: 0, minusDi: 0 };
  const rows = bars.slice(1).map((bar, index) => {
    const previous = bars[index];
    const up = bar.high - previous.high;
    const down = previous.low - bar.low;
    return {
      tr: Math.max(bar.high - bar.low, Math.abs(bar.high - previous.close), Math.abs(bar.low - previous.close)),
      plus: up > down && up > 0 ? up : 0,
      minus: down > up && down > 0 ? down : 0,
    };
  });
  let smoothedTr = rows.slice(0, period).reduce((sum, row) => sum + row.tr, 0);
  let smoothedPlus = rows.slice(0, period).reduce((sum, row) => sum + row.plus, 0);
  let smoothedMinus = rows.slice(0, period).reduce((sum, row) => sum + row.minus, 0);
  const dxValues: number[] = [];
  const collectDx = () => {
    const plusDi = smoothedTr > 0 ? smoothedPlus / smoothedTr * 100 : 0;
    const minusDi = smoothedTr > 0 ? smoothedMinus / smoothedTr * 100 : 0;
    const total = plusDi + minusDi;
    dxValues.push(total > 0 ? Math.abs(plusDi - minusDi) / total * 100 : 0);
    return { plusDi, minusDi };
  };
  let directional = collectDx();
  for (const row of rows.slice(period)) {
    smoothedTr = smoothedTr - smoothedTr / period + row.tr;
    smoothedPlus = smoothedPlus - smoothedPlus / period + row.plus;
    smoothedMinus = smoothedMinus - smoothedMinus / period + row.minus;
    directional = collectDx();
  }
  return {
    atr: smoothedTr / period,
    adx: average(dxValues.slice(-period)),
    plusDi: directional.plusDi,
    minusDi: directional.minusDi,
  };
}

function indicators(bars: PaperDailyBar[], benchmark: PaperDailyBar[]): IndicatorSnapshot | null {
  if (bars.length < 100 || benchmark.length < 21) return null;
  const closes = bars.map((bar) => bar.close);
  const latest = bars.at(-1)!;
  const directional = directionalMovement(bars);
  const symbolStart = bars.at(-21)!.close;
  const benchmarkStart = benchmark.at(-21)!.close;
  const benchmarkEnd = benchmark.at(-1)!.close;
  const macd = ema(closes, 12) - ema(closes, 26);
  const macdSeries = closes.slice(-45).map((_, index, values) => {
    const window = closes.slice(0, closes.length - values.length + index + 1);
    return ema(window, 12) - ema(window, 26);
  });
  return {
    ema20: ema(closes, 20),
    ema50: ema(closes, 50),
    ema100: ema(closes, 100),
    rsi14: rsi(closes),
    atr14: directional.atr,
    adx14: directional.adx,
    plusDi14: directional.plusDi,
    minusDi14: directional.minusDi,
    macdHistogram: macd - ema(macdSeries, 9),
    relativeVolume20: latest.volume / Math.max(average(bars.slice(-21, -1).map((bar) => bar.volume)), 1),
    relativeStrength20: (latest.close / symbolStart - 1) - (benchmarkEnd / benchmarkStart - 1),
    priorHigh20: Math.max(...bars.slice(-21, -1).map((bar) => bar.high)),
    recentLow10: Math.min(...bars.slice(-10).map((bar) => bar.low)),
  };
}

function rounded(value: number) {
  return Math.round(value * 10_000) / 10_000;
}

export function buildPaperTradingSignal(input: {
  bars: PaperDailyBar[];
  benchmarkBars: PaperDailyBar[];
  strategyVersion: string;
}): PaperTradingSignalInput | null {
  const bars = [...input.bars].sort((left, right) => left.marketDate.localeCompare(right.marketDate));
  const signalBar = bars.at(-1);
  if (!signalBar) return null;
  const benchmark = input.benchmarkBars
    .filter((bar) => bar.marketDate <= signalBar.marketDate)
    .sort((left, right) => left.marketDate.localeCompare(right.marketDate));
  const snapshot = indicators(bars, benchmark);
  if (!snapshot || snapshot.atr14 <= 0) return null;

  const closes = bars.map((bar) => bar.close);
  const priorEma20 = ema(closes.slice(0, -5), 20);
  const priorEma50 = ema(closes.slice(0, -5), 50);
  const marketCloses = benchmark.map((bar) => bar.close);
  const marketRiskOn = benchmark.at(-1)!.close > ema(marketCloses, 50) && ema(marketCloses, 20) > ema(marketCloses, 50);
  const uptrend = signalBar.close > snapshot.ema20
    && snapshot.ema20 > snapshot.ema50
    && snapshot.ema50 > snapshot.ema100
    && snapshot.ema20 > priorEma20
    && snapshot.ema50 > priorEma50;
  if (!marketRiskOn || !uptrend || snapshot.relativeStrength20 <= 0 || snapshot.plusDi14 <= snapshot.minusDi14) return null;

  const breakout = signalBar.close > snapshot.priorHigh20
    && snapshot.rsi14 >= 52 && snapshot.rsi14 <= 82
    && snapshot.macdHistogram > 0
    && snapshot.adx14 >= 18
    && snapshot.relativeVolume20 >= 1.15;
  const pullbackReclaim = signalBar.low <= snapshot.ema20 * 1.012
    && signalBar.close >= snapshot.ema20
    && signalBar.close > signalBar.open
    && snapshot.rsi14 >= 48 && snapshot.rsi14 <= 68
    && snapshot.macdHistogram >= 0
    && snapshot.adx14 >= 15
    && snapshot.relativeVolume20 >= 0.8;
  if (!breakout && !pullbackReclaim) return null;

  const strategy = breakout ? "TREND_BREAKOUT" : "EMA20_PULLBACK_RECLAIM";
  const stop = Math.min(
    signalBar.close - snapshot.atr14 * (breakout ? 2 : 1.6),
    snapshot.recentLow10 - snapshot.atr14 * 0.25,
  );
  if (!(stop > 0 && stop < signalBar.close)) return null;
  const risk = signalBar.close - stop;
  const score = Math.min(100,
    45
      + Math.min(snapshot.adx14, 35) * 0.6
      + Math.min(snapshot.relativeVolume20, 3) * 8
      + Math.min(snapshot.relativeStrength20 * 100, 15)
      + (breakout ? 8 : 3),
  );
  const reasons = [
    "SPY risk-on regime",
    "EMA20 > EMA50 > EMA100",
    `ADX ${snapshot.adx14.toFixed(1)} / +DI dominance`,
    `20-session relative strength ${(snapshot.relativeStrength20 * 100).toFixed(1)}%p`,
    `relative volume ${snapshot.relativeVolume20.toFixed(2)}x`,
    breakout ? "20-session closing breakout" : "EMA20 pullback and reclaim",
  ];
  return {
    id: `${input.strategyVersion}:${signalBar.symbol}:${signalBar.marketDate}:${strategy}`,
    symbol: signalBar.symbol,
    name: signalBar.name,
    strategy,
    strategyVersion: input.strategyVersion,
    signalDate: signalBar.marketDate,
    referencePriceUsd: rounded(signalBar.close),
    stopPriceUsd: rounded(stop),
    targetPriceUsd: rounded(signalBar.close + risk * 2),
    score: rounded(score),
    reasons,
  };
}

function crossSectionalZScore(values: Map<string, number>) {
  const entries = [...values.entries()];
  if (!entries.length) return new Map<string, number>();
  const mean = entries.reduce((sum, [, value]) => sum + value, 0) / entries.length;
  const variance = entries.reduce((sum, [, value]) => sum + (value - mean) ** 2, 0) / entries.length;
  const deviation = Math.sqrt(variance);
  return new Map(entries.map(([symbol, value]) => [symbol, deviation > 0 ? (value - mean) / deviation : 0]));
}

export function quarterKeyForMarketDate(value: string) {
  const match = /^(\d{4})-(\d{2})-\d{2}$/.exec(value);
  if (!match) throw new Error(`Invalid market date: ${value}`);
  const quarter = Math.floor((Number(match[2]) - 1) / 3) + 1;
  return `${match[1]}-Q${quarter}`;
}

export function nextQuarterDate(value: string) {
  const match = /^(\d{4})-(\d{2})-\d{2}$/.exec(value);
  if (!match) throw new Error(`Invalid market date: ${value}`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const nextMonth = Math.floor((month - 1) / 3) * 3 + 4;
  return `${nextMonth > 12 ? year + 1 : year}-${String(nextMonth > 12 ? 1 : nextMonth).padStart(2, "0")}-01`;
}

export function buildQuarterlyMomentumTargets(input: {
  series: Map<string, PaperDailyBar[]>;
  sectors: Map<string, string>;
  signalDate: string;
  maximumTargets?: number;
  maximumPerSector?: number;
  targetWeightPercent?: number;
}): PaperTradingRotationTarget[] {
  const rows = new Map<string, { bar: PaperDailyBar; momentum6: number; momentum12: number }>();
  for (const [symbol, source] of input.series) {
    if (symbol === "SPY") continue;
    const bars = [...source]
      .filter((bar) => bar.marketDate <= input.signalDate)
      .sort((left, right) => left.marketDate.localeCompare(right.marketDate));
    if (bars.length < 253) continue;
    const latest = bars.at(-1)!;
    const closeOneMonthAgo = bars.at(-22)!.close;
    const closeSixMonthsAgo = bars.at(-127)!.close;
    const closeTwelveMonthsAgo = bars.at(-253)!.close;
    const momentum6 = closeOneMonthAgo / closeSixMonthsAgo - 1;
    const momentum12 = closeOneMonthAgo / closeTwelveMonthsAgo - 1;
    if (![momentum6, momentum12].every(Number.isFinite)) continue;
    rows.set(symbol, { bar: latest, momentum6, momentum12 });
  }
  const six = crossSectionalZScore(new Map([...rows].map(([symbol, row]) => [symbol, row.momentum6])));
  const twelve = crossSectionalZScore(new Map([...rows].map(([symbol, row]) => [symbol, row.momentum12])));
  const ordered = [...rows.entries()]
    .map(([symbol, row]) => ({ symbol, row, score: (six.get(symbol)! + twelve.get(symbol)!) / 2 }))
    .sort((left, right) => right.score - left.score || left.symbol.localeCompare(right.symbol));
  const maximumTargets = input.maximumTargets ?? 8;
  const maximumPerSector = input.maximumPerSector ?? 3;
  const targetWeightPercent = input.targetWeightPercent ?? 10;
  const sectorCounts = new Map<string, number>();
  const selected: PaperTradingRotationTarget[] = [];
  for (const candidate of ordered) {
    const sector = input.sectors.get(candidate.symbol) ?? "other";
    if ((sectorCounts.get(sector) ?? 0) >= maximumPerSector) continue;
    selected.push({
      rank: selected.length + 1,
      symbol: candidate.symbol,
      name: candidate.row.bar.name,
      sector,
      score: rounded(candidate.score),
      momentum6MonthPercent: rounded(candidate.row.momentum6 * 100),
      momentum12MonthPercent: rounded(candidate.row.momentum12 * 100),
      targetWeightPercent,
    });
    sectorCounts.set(sector, (sectorCounts.get(sector) ?? 0) + 1);
    if (selected.length >= maximumTargets) break;
  }
  return selected;
}
