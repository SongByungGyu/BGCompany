import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { assertPaperTradingSafe, getPaperTradingConfig } from "./paper-trading-config.ts";
import {
  calculatePaperPositionSize,
  entryGapPercent,
  quoteIsStale,
  simulatedEntryPrice,
} from "./paper-trading-rules.ts";

const rules = getPaperTradingConfig({ TRADING_MODE: "PAPER" }).rules;

test("position size uses the smaller of account risk and the 10% position cap", () => {
  const result = calculatePaperPositionSize({
    equityKrw: 10_000_000,
    cashKrw: 10_000_000,
    currentExposureKrw: 0,
    entryPriceUsd: 100,
    stopPriceUsd: 95,
    usdKrw: 1_400,
    rules,
  });
  assert.equal(result.quantity, 7);
  assert.equal(result.riskBudgetKrw, 50_000);
  assert.equal(result.positionBudgetKrw, 1_000_000);
});

test("invalid stop price rejects a paper position", () => {
  const result = calculatePaperPositionSize({
    equityKrw: 10_000_000,
    cashKrw: 10_000_000,
    currentExposureKrw: 0,
    entryPriceUsd: 100,
    stopPriceUsd: 101,
    usdKrw: 1_400,
    rules,
  });
  assert.equal(result.quantity, 0);
  assert.equal(result.reason, "INVALID_STOP");
});

test("LIVE mode and the live enable flag are always rejected", () => {
  assert.throws(() => assertPaperTradingSafe({ TRADING_MODE: "LIVE" }), /실계좌 실행은 차단/);
  assert.throws(() => assertPaperTradingSafe({ TRADING_MODE: "PAPER", LIVE_TRADING_ENABLED: "true" }), /실계좌 실행은 차단/);
});

test("paper mode remains internally simulated", () => {
  const config = assertPaperTradingSafe({ TRADING_MODE: "PAPER" });
  assert.equal(config.safeToRun, true);
  assert.equal(simulatedEntryPrice(100, 15), 100.15);
});

test("entry gap and stale data guards are deterministic", () => {
  assert.equal(entryGapPercent(100, 109), 9.000000000000007);
  assert.equal(quoteIsStale("2026-08-07T20:00:00Z", "2026-08-08T20:00:00Z", 36), false);
  assert.equal(quoteIsStale("2026-08-06T20:00:00Z", "2026-08-08T20:00:00Z", 36), true);
});

test("paper service contains no broker network or KIS order path", () => {
  const source = readFileSync(new URL("./paper-trading-service.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /fetch\s*\(/);
  assert.doesNotMatch(source, /\/uapi\/.*order/i);
  assert.doesNotMatch(source, /LIVE_TRADING_ENABLED\s*=\s*true/);
  assert.match(source, /INTERNAL_VIRTUAL_BROKER/);
});
