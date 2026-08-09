export type PaperTradingSystemStatus = "ACTIVE" | "PAUSED" | "KILLED";

export type PaperTradingRules = {
  riskPerTrade: number;
  maxPositionPercent: number;
  maxOpenPositions: number;
  maxNewPositionsPerDay: number;
  maxTotalExposurePercent: number;
  slippageBps: number;
  commissionBps: number;
  maximumEntryGapPercent: number;
  staleAfterHours: number;
};

export type PaperTradingQuoteInput = {
  symbol: string;
  name?: string;
  marketDate: string;
  observedAt: string;
  open: number;
  high: number;
  low: number;
  close: number;
};

export type PaperTradingSignalInput = {
  id: string;
  symbol: string;
  name: string;
  strategy: string;
  strategyVersion: string;
  signalDate: string;
  referencePriceUsd: number;
  stopPriceUsd: number;
  targetPriceUsd?: number | null;
  score: number;
  reasons: string[];
};

export type PaperTradingCycleInput = {
  marketDate: string;
  observedAt: string;
  usdKrw: number;
  quotes: PaperTradingQuoteInput[];
  signals: PaperTradingSignalInput[];
};

export type PaperTradingPositionDto = {
  id: string;
  symbol: string;
  name: string;
  strategy: string;
  quantity: number;
  entryDate: string;
  entryPriceUsd: string;
  lastPriceUsd: string;
  stopPriceUsd: string;
  targetPriceUsd: string | null;
  marketValueKrw: string;
  unrealizedPnlKrw: string;
  returnPercent: string;
};

export type PaperTradingActivityDto = {
  id: string;
  type: "order" | "trade" | "risk";
  symbol: string | null;
  status: string;
  title: string;
  detail: string;
  occurredAt: string;
};

export type PaperTradingDashboard = {
  enabled: true;
  mode: "PAPER";
  externalOrderAuthorization: "NONE";
  executionVenue: "INTERNAL_VIRTUAL_BROKER";
  account: null | {
    id: string;
    name: string;
    baseCurrency: "KRW";
    initialCapitalKrw: string;
    cashKrw: string;
    equityKrw: string;
    marketValueKrw: string;
    realizedPnlKrw: string;
    unrealizedPnlKrw: string;
    totalReturnPercent: string;
    status: PaperTradingSystemStatus;
    lastMarketDate: string | null;
    lastRunAt: string | null;
    usdKrw: string | null;
  };
  rules: PaperTradingRules;
  positions: PaperTradingPositionDto[];
  activity: PaperTradingActivityDto[];
  counts: {
    openPositions: number;
    ordersToday: number;
    newPositionsToday: number;
    rejectedSignalsToday: number;
    closedTrades: number;
  };
  automation?: PaperTradingAutomationStatus;
};

export type PaperTradingAutomationStatus = {
  enabled: boolean;
  cron: string;
  timezone: string;
  retryLimit: number;
  status: string;
  lastRunAt: string | null;
  lastMarketDate: string | null;
  signalDate: string | null;
  candidateCount: number;
  loadedSymbols: number;
  universeSize: number;
  nextRunAt: string;
  attempt: number;
  error: string | null;
  provider: string;
  baselineOnly: boolean;
};

export type PaperTradingDisabled = {
  enabled: false;
  message: string;
  mode: "PAPER";
  externalOrderAuthorization: "NONE";
};

export type PaperTradingResponse = PaperTradingDashboard | PaperTradingDisabled;
