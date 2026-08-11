import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPaperTradingSignal,
  buildQuarterlyMomentumTargets,
  latestCompletedUsMarketDate,
  nextQuarterDate,
  quarterKeyForMarketDate,
  type PaperDailyBar,
} from "./paper-trading-strategy.ts";

function bars(symbol: string, relativeStrength = 1): PaperDailyBar[] {
  const rows: PaperDailyBar[] = [];
  let close = 80;
  for (let index = 0; index < 125; index += 1) {
    const previous = close;
    const dailyMove = index % 4 === 0 ? -0.0045 : 0.0032 + index / 150_000;
    close = previous * (1 + dailyMove * relativeStrength);
    if (index === 124) close *= 1.015;
    rows.push({
      symbol,
      name: symbol,
      exchange: symbol === "SPY" ? "AMS" : "NAS",
      marketDate: new Date(Date.UTC(2026, 0, index + 1)).toISOString().slice(0, 10),
      open: previous,
      high: close * 1.008,
      low: Math.min(previous, close) * 0.994,
      close,
      volume: index === 124 ? 2_500_000 : 1_000_000,
    });
  }
  return rows;
}

test("rising liquid symbol creates a deterministic next-session candidate", () => {
  const signal = buildPaperTradingSignal({ bars: bars("NVDA", 1.25), benchmarkBars: bars("SPY"), strategyVersion: "v-test" });
  assert.ok(signal);
  assert.equal(signal.symbol, "NVDA");
  assert.match(signal.id, /^v-test:NVDA:/);
  assert.ok(signal.stopPriceUsd < signal.referencePriceUsd);
  assert.ok((signal.targetPriceUsd ?? 0) > signal.referencePriceUsd);
});

test("no signal is created with insufficient history", () => {
  const signal = buildPaperTradingSignal({ bars: bars("NVDA").slice(-50), benchmarkBars: bars("SPY"), strategyVersion: "v-test" });
  assert.equal(signal, null);
});

test("benchmark risk-off regime blocks entries", () => {
  const benchmark = bars("SPY").map((bar, index, all) => ({ ...bar, close: 160 - index * 0.7, open: 160 - index * 0.7 + 0.2, high: 160 - index * 0.7 + 0.5, low: 160 - index * 0.7 - 0.5 }));
  const signal = buildPaperTradingSignal({ bars: bars("NVDA", 1.25), benchmarkBars: benchmark, strategyVersion: "v-test" });
  assert.equal(signal, null);
});

function momentumBars(symbol: string, dailyReturn: number): PaperDailyBar[] {
  return Array.from({ length: 270 }, (_, index) => {
    const close = 50 * (1 + dailyReturn) ** index;
    return {
      symbol,
      name: symbol,
      exchange: "NAS",
      marketDate: new Date(Date.UTC(2025, 0, index + 1)).toISOString().slice(0, 10),
      open: close,
      high: close * 1.01,
      low: close * 0.99,
      close,
      volume: 1_000_000,
    };
  });
}

test("quarterly blend ranks 6-1 and 12-1 momentum with a three-name sector cap", () => {
  const symbols = ["T1", "T2", "T3", "T4", "T5", "F1", "F2", "H1", "H2", "E1"];
  const series = new Map(symbols.map((symbol, index) => [symbol, momentumBars(symbol, 0.004 - index * 0.0002)]));
  const signalDate = series.get("T1")!.at(-1)!.marketDate;
  const sectors = new Map(symbols.map((symbol) => [symbol, symbol.startsWith("T") ? "tech" : symbol.startsWith("F") ? "finance" : symbol.startsWith("H") ? "healthcare" : "energy"]));
  const targets = buildQuarterlyMomentumTargets({ series, sectors, signalDate });
  assert.equal(targets.length, 8);
  assert.deepEqual(targets.slice(0, 3).map((target) => target.symbol), ["T1", "T2", "T3"]);
  assert.equal(targets.filter((target) => target.sector === "tech").length, 3);
  assert.ok(targets.every((target) => target.targetWeightPercent === 10));
});

test("quarter helpers keep a locked plan on the calendar quarter boundary", () => {
  assert.equal(quarterKeyForMarketDate("2026-08-10"), "2026-Q3");
  assert.equal(nextQuarterDate("2026-08-10"), "2026-10-01");
  assert.equal(nextQuarterDate("2026-12-31"), "2027-01-01");
});

test("incomplete current US session is excluded before the regular close buffer", () => {
  const history = momentumBars("SPY", 0.001).slice(-2).map((bar, index) => ({
    ...bar,
    marketDate: index === 0 ? "2026-08-10" : "2026-08-11",
  }));
  assert.equal(latestCompletedUsMarketDate(history, new Date("2026-08-11T12:00:00.000Z")), "2026-08-10");
});

test("current US session becomes eligible after the regular close buffer", () => {
  const history = momentumBars("SPY", 0.001).slice(-2).map((bar, index) => ({
    ...bar,
    marketDate: index === 0 ? "2026-08-10" : "2026-08-11",
  }));
  assert.equal(latestCompletedUsMarketDate(history, new Date("2026-08-11T21:00:00.000Z")), "2026-08-11");
});
