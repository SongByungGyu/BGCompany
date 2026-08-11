import type { PaperTradingRules } from "./paper-trading-types";

function positiveNumber(value: string | undefined, fallback: number, maximum: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, maximum) : fallback;
}

function positiveInteger(value: string | undefined, fallback: number, maximum: number) {
  return Math.floor(positiveNumber(value, fallback, maximum));
}

export function getPaperTradingConfig(environment: Record<string, string | undefined> = process.env) {
  const requestedMode = (environment.TRADING_MODE ?? "PAPER").trim().toUpperCase();
  const liveRequested = requestedMode === "LIVE" || environment.LIVE_TRADING_ENABLED === "true";

  return {
    enabled: environment.PORTFOLIO_PAPER_TRADING_ENABLED !== "false",
    safeToRun: !liveRequested && (requestedMode === "PAPER" || requestedMode === "BACKTEST"),
    requestedMode,
    initialCapitalKrw: positiveNumber(environment.PAPER_INITIAL_CAPITAL_KRW, 10_000_000, 10_000_000_000),
    strategyVersion: environment.PAPER_STRATEGY_VERSION?.trim() || "blend-quarterly-v1",
    rules: {
      riskPerTrade: positiveNumber(environment.PAPER_RISK_PER_TRADE, 0.005, 0.02),
      maxPositionPercent: positiveNumber(environment.PAPER_MAX_POSITION_PERCENT, 0.10, 0.25),
      maxOpenPositions: positiveInteger(environment.PAPER_MAX_OPEN_POSITIONS, 8, 50),
      maxNewPositionsPerDay: positiveInteger(environment.PAPER_MAX_NEW_POSITIONS_PER_DAY, 3, 20),
      maxTotalExposurePercent: positiveNumber(environment.PAPER_MAX_TOTAL_EXPOSURE_PERCENT, 0.80, 1),
      slippageBps: positiveNumber(environment.PAPER_SLIPPAGE_BPS, 15, 200),
      commissionBps: positiveNumber(environment.PAPER_COMMISSION_BPS, 0.5, 100),
      maximumEntryGapPercent: positiveNumber(environment.PAPER_MAX_ENTRY_GAP_PERCENT, 8, 30),
      staleAfterHours: positiveNumber(environment.PAPER_STALE_AFTER_HOURS, 36, 168),
      fxSlippageBps: positiveNumber(environment.PAPER_FX_SLIPPAGE_BPS, 10, 100),
    } satisfies PaperTradingRules,
  };
}

export function assertPaperTradingSafe(environment: Record<string, string | undefined> = process.env) {
  const config = getPaperTradingConfig(environment);
  if (!config.enabled) throw new Error("모의투자 기능이 비활성화되어 있습니다.");
  if (!config.safeToRun) {
    throw new Error(`실계좌 실행은 차단되어 있습니다. 요청 모드: ${config.requestedMode}`);
  }
  return config;
}
