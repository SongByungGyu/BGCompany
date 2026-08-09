import assert from "node:assert/strict";
import test from "node:test";
import { buildPaperTradingSignal, type PaperDailyBar } from "./paper-trading-strategy.ts";

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
