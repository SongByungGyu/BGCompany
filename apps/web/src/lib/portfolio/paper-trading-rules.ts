import type { PaperTradingRules } from "./paper-trading-types";

export type PaperPositionSizeInput = {
  equityKrw: number;
  cashKrw: number;
  currentExposureKrw: number;
  entryPriceUsd: number;
  stopPriceUsd: number;
  usdKrw: number;
  rules: PaperTradingRules;
};

export type PaperPositionSizeResult = {
  quantity: number;
  riskBudgetKrw: number;
  positionBudgetKrw: number;
  reason: string | null;
};

function finitePositive(value: number) {
  return Number.isFinite(value) && value > 0;
}

export function calculatePaperPositionSize(input: PaperPositionSizeInput): PaperPositionSizeResult {
  const { equityKrw, cashKrw, currentExposureKrw, entryPriceUsd, stopPriceUsd, usdKrw, rules } = input;
  if (![equityKrw, cashKrw, entryPriceUsd, stopPriceUsd, usdKrw].every(finitePositive)) {
    return { quantity: 0, riskBudgetKrw: 0, positionBudgetKrw: 0, reason: "INVALID_NUMBER" };
  }
  if (stopPriceUsd >= entryPriceUsd) {
    return { quantity: 0, riskBudgetKrw: 0, positionBudgetKrw: 0, reason: "INVALID_STOP" };
  }

  const riskBudgetKrw = equityKrw * rules.riskPerTrade;
  const riskPerShareKrw = (entryPriceUsd - stopPriceUsd) * usdKrw;
  const positionCapKrw = equityKrw * rules.maxPositionPercent;
  const exposureCapacityKrw = Math.max(0, equityKrw * rules.maxTotalExposurePercent - currentExposureKrw);
  const positionBudgetKrw = Math.max(0, Math.min(positionCapKrw, exposureCapacityKrw, cashKrw));
  const entryNotionalPerShareKrw = entryPriceUsd * usdKrw;
  const byRisk = Math.floor(riskBudgetKrw / riskPerShareKrw);
  const byBudget = Math.floor(positionBudgetKrw / entryNotionalPerShareKrw);
  const quantity = Math.max(0, Math.min(byRisk, byBudget));

  return {
    quantity,
    riskBudgetKrw,
    positionBudgetKrw,
    reason: quantity > 0 ? null : "POSITION_TOO_SMALL",
  };
}

export function simulatedEntryPrice(openPriceUsd: number, slippageBps: number) {
  return openPriceUsd * (1 + slippageBps / 10_000);
}

export function simulatedExitPrice(referencePriceUsd: number, slippageBps: number) {
  return referencePriceUsd * (1 - slippageBps / 10_000);
}

export function commissionKrw(notionalKrw: number, commissionBps: number) {
  return Math.max(0, notionalKrw * commissionBps / 10_000);
}

export function entryGapPercent(referencePriceUsd: number, openPriceUsd: number) {
  if (!finitePositive(referencePriceUsd) || !finitePositive(openPriceUsd)) return Number.POSITIVE_INFINITY;
  return Math.abs(openPriceUsd / referencePriceUsd - 1) * 100;
}

export function quoteIsStale(observedAt: string, cycleObservedAt: string, staleAfterHours: number) {
  const quoteTime = new Date(observedAt).getTime();
  const cycleTime = new Date(cycleObservedAt).getTime();
  if (!Number.isFinite(quoteTime) || !Number.isFinite(cycleTime) || quoteTime > cycleTime) return true;
  return cycleTime - quoteTime > staleAfterHours * 60 * 60 * 1000;
}

export function normalizeSymbol(value: string) {
  return value.trim().toUpperCase();
}
