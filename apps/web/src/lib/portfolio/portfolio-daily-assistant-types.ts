export type DailySnapshotHolding = {
  holdingId: string;
  market: string;
  symbol: string;
  name: string;
  quantity: string;
  averagePrice: string;
  currentPrice: string | null;
  dailyChangePercent?: string | null;
  currency: string;
  exchangeRate: string | null;
  marketValue: string | null;
  costBasis: string | null;
  unrealizedProfitLoss: string | null;
  returnPercent: string | null;
  weightPercent: string | null;
  priceObservedAt: string | null;
  freshnessStatus: string;
};

export type DailyHoldingChange = {
  holdingId: string;
  symbol: string;
  name: string;
  changeType: "added" | "quantity_increased" | "quantity_decreased" | "average_price_changed" | "inactive" | "unchanged";
  previousQuantity: string | null;
  currentQuantity: string | null;
  quantityChange: string | null;
  previousAveragePrice: string | null;
  currentAveragePrice: string | null;
  previousMarketValue: string | null;
  currentMarketValue: string | null;
};

export type DailyAttribution = {
  holdingId: string;
  symbol: string;
  name: string;
  currency: string;
  totalMarketValueChange: string;
  quantityEffect: string;
  priceEffect: string;
  fxEffect: string;
  residualEffect: string;
  quantityChanged: boolean;
  method: "sequential_quantity_price_fx";
};

export type PortfolioDailyAssistantView = {
  enabled: true;
  generatedAt: string;
  status: "ready" | "collecting" | "partial" | "needs_data";
  headline: string;
  summary: string;
  snapshot: {
    id: string;
    marketDate: string;
    capturedAt: string;
    comparisonCapturedAt: string | null;
    comparisonLabel: string;
    baseCurrency: string;
    totalMarketValue: string;
    totalCostBasis: string;
    totalUnrealizedProfitLoss: string;
    totalReturnPercent: string;
    totalChange: string | null;
    holdingCount: number;
    dataQuality: string;
    freshnessStatus: string;
    missingItems: string[];
  } | null;
  changes: DailyHoldingChange[];
  attribution: {
    quantityEffect: string;
    priceEffect: string;
    fxEffect: string;
    residualEffect: string;
    totalChange: string;
    items: DailyAttribution[];
  } | null;
  topContributors: {
    positive: DailyAttribution[];
    negative: DailyAttribution[];
  };
  alerts: Array<{ type: string; severity: "warning" | "critical"; message: string; symbol?: string }>;
};

export type PortfolioDailyAssistantDisabled = {
  enabled: false;
  message: string;
};

export type PortfolioPerformancePoint = {
  snapshotId: string;
  marketDate: string;
  capturedAt: string;
  totalMarketValue: string;
  totalCostBasis: string;
  totalUnrealizedProfitLoss: string;
  holdingCount: number;
  quantityChangeCount: number;
  status: string;
};

export type PortfolioPerformanceResponse = {
  enabled: boolean;
  range: "7d" | "30d" | "3m" | "ytd" | "all";
  sufficient: boolean;
  message: string;
  points: PortfolioPerformancePoint[];
};
