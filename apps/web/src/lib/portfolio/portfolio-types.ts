export type PortfolioMarket = "KR" | "US";
export type PortfolioCurrency = "KRW" | "USD";
export type PortfolioAssetType = "stock" | "ETF" | "fund" | "cash";
export type FreshnessStatus = "fresh" | "delayed" | "stale" | "unavailable";
export type DividendStatus = "confirmed" | "announced" | "estimated" | "historical" | "unavailable";
export type RiskSeverity = "info" | "warning" | "high";
export type PortfolioReportType = "DAILY" | "WEEKLY" | "DIVIDEND" | "RISK";

export type PortfolioAccountDto = {
  id: string;
  name: string;
  baseCurrency: PortfolioCurrency;
  description: string | null;
  source: "manual" | "kis" | "toss";
  lastSyncedAt: string | null;
  lastSyncStatus: string | null;
  lastSyncMessage: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type PortfolioHoldingDto = {
  id: string;
  portfolioAccountId: string;
  market: PortfolioMarket;
  symbol: string;
  name: string;
  assetType: PortfolioAssetType;
  quantity: string;
  averagePrice: string;
  currency: PortfolioCurrency;
  sector: string;
  note: string | null;
  source: "manual" | "kis" | "toss";
  lastSyncedAt: string | null;
  dividendTrackingEnabled: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type PortfolioPriceDto = {
  symbol: string;
  market: PortfolioMarket;
  currentPrice: string | null;
  currency: PortfolioCurrency;
  change: string | null;
  changePercent: string | null;
  weeklyChangePercent: string | null;
  observedAt: string | null;
  collectedAt: string | null;
  sourceName: string;
  sourceUrl: string | null;
  freshnessStatus: FreshnessStatus;
};

export type HoldingValuationDto = {
  holding: PortfolioHoldingDto;
  price: PortfolioPriceDto;
  nativeMarketValue: string | null;
  nativeCostBasis: string;
  nativeProfitLoss: string | null;
  baseMarketValue: string | null;
  baseCostBasis: string | null;
  baseProfitLoss: string | null;
  returnPercent: string | null;
  weightPercent: string | null;
  expectedAnnualDividend: string | null;
  dividendStatus: DividendStatus;
  provisional: boolean;
  missingItems: string[];
};

export type AllocationDto = {
  key: string;
  label: string;
  value: string;
  weightPercent: string;
};

export type DividendEventDto = {
  id: string;
  market: PortfolioMarket;
  symbol: string;
  name: string;
  exDividendDate: string | null;
  paymentDate: string | null;
  dividendType: string;
  amountPerShare: string | null;
  annualizedAmountPerShare: string | null;
  expectedAmount: string | null;
  currency: PortfolioCurrency;
  status: DividendStatus;
  dataQuality: string;
  sourceName: string | null;
  sourceUrl: string | null;
};

export type PortfolioNewsDto = {
  id: string;
  market: PortfolioMarket;
  symbol: string;
  title: string;
  sourceName: string;
  url: string;
  publishedAt: string;
  summary: string | null;
  riskCategory: string | null;
  relevanceScore: string | null;
};

export type PortfolioRiskDto = {
  id: string;
  holdingId: string | null;
  type: string;
  severity: RiskSeverity;
  title: string;
  message: string;
  detectedAt: string;
};

export type PortfolioReportDto = {
  id: string;
  reportType: PortfolioReportType;
  reportDate: string;
  summary: string;
  body: string;
  dataQuality: string;
  status: string;
};

export type PortfolioDashboard = {
  enabled: true;
  generatedAt: string;
  dataAsOf: string | null;
  account: PortfolioAccountDto | null;
  accounts: PortfolioAccountDto[];
  accountSync: {
    enabled: boolean;
    configured: boolean;
    provider: "toss";
    readOnly: true;
    maskedAccount: string | null;
    lastSyncedAt: string | null;
    lastSyncStatus: string | null;
    lastSyncMessage: string | null;
  };
  autoSync: {
    enabled: boolean;
    cron: string;
    timezone: string;
    retryLimit: number;
    status: string;
    lastAccountSyncedAt: string | null;
    lastPriceRefreshedAt: string | null;
    changedCount: number;
    createdCount: number;
    updatedCount: number;
    deactivatedCount: number;
    nextRunAt: string;
    error: string | null;
    freshnessWarning: string | null;
    lastAttempt: number;
  };
  holdings: HoldingValuationDto[];
  summary: {
    baseCurrency: PortfolioCurrency;
    totalMarketValue: string;
    totalCostBasis: string;
    totalProfitLoss: string;
    totalReturnPercent: string;
    expectedAnnualDividend: string;
    todayChangeAmount: string | null;
    exchangeRate: string | null;
    exchangeRateAsOf: string | null;
    exchangeRateSource: string | null;
    dataQuality: "verified" | "provisional" | "unavailable";
    missingItems: string[];
  };
  allocations: {
    holdings: AllocationDto[];
    sectors: AllocationDto[];
    markets: AllocationDto[];
    currencies: AllocationDto[];
  };
  dividends: DividendEventDto[];
  news: PortfolioNewsDto[];
  risks: PortfolioRiskDto[];
  reports: PortfolioReportDto[];
  briefing: string;
  team: Array<{ id: string; role: string; status: string }>;
};

export type PortfolioDisabledResponse = {
  enabled: false;
  message: string;
};

export type PortfolioResponse = PortfolioDashboard | PortfolioDisabledResponse;
