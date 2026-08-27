export type StockReferenceBriefingTemplate =
  | "KOREA_DAILY_PREVIEW"
  | "KOREA_MARKET_CLOSE_US_PREVIEW"
  | "WEEKLY_MARKET_REVIEW"
  | "NEXT_WEEK_MARKET_PREVIEW"
  | "INVESTMENT_STUDY"
  | "LARGE_CAP_DISCLOSURE_EARNINGS";

export type ReferenceSourceType = "news" | "blog" | "disclosure" | "market_data" | "calendar" | "sector" | "company" | "macro" | "manual" | "mock";
export type ReferenceProviderStatus = "ready" | "disabled" | "needs_credentials" | "needs_reference" | "needs_data" | "error";

export type ReferenceItem = {
  id: string;
  sourceType: ReferenceSourceType;
  provider: string;
  title: string;
  url?: string;
  originalUrl?: string;
  publisher?: string;
  sourceName?: string;
  publishedAt?: string;
  collectedAt?: string;
  summary?: string;
  query?: string;
  keywords?: string[];
  relevanceScore?: number;
  usageNote?: string;
  copyrightPolicy?: string;
  contentType?: StockReferenceBriefingTemplate;
  market?: "KR" | "US" | "GLOBAL";
  symbols?: string[];
  reliability?: "official" | "major_media" | "aggregator" | "manual" | "mock";
};

export type CompetitorBlogReference = {
  title: string;
  description?: string;
  url?: string;
  blogName?: string;
  publishedAt?: string;
  keywords: string[];
  observedStructure?: string[];
  differentiationPoint?: string;
  structure?: CompetitorBlogStructureMetrics;
};

export type CompetitorBlogStructureMetrics = {
  status: "analyzed" | "fetch_failed" | "metadata_only";
  analyzedAt: string;
  sourceUrl?: string;
  errorCode?: string;
  titleLength?: number;
  bodyLength?: number;
  introLength?: number;
  paragraphCount?: number;
  headingCount?: number;
  imageCount?: number;
  linkCount?: number;
  listItemCount?: number;
  tableCount?: number;
  hasDateInTitle?: boolean;
  hasChecklist?: boolean;
  hasSourceSection?: boolean;
  hasDisclaimer?: boolean;
  hasCallToAction?: boolean;
  observedStructure: string[];
};

export type CompetitorBlogAnalysisSummary = {
  requestedCount: number;
  analyzedCount: number;
  failedCount: number;
  averages: {
    titleLength: number;
    bodyLength: number;
    introLength: number;
    paragraphCount: number;
    headingCount: number;
    imageCount: number;
    linkCount: number;
  };
  commonPatterns: string[];
  differentiationOpportunities: string[];
  recommendedStructure: string[];
  copyrightPolicy: string;
};

export type MarketSnapshotMetric = {
  label: string;
  value?: number | string;
  unit?: string;
  changePct?: number;
  direction?: "up" | "down" | "flat" | "mixed";
  asOf?: string;
  collectedAt?: string;
  freshness?: "fresh" | "stale" | "expired" | "unknown";
  ageMinutes?: number;
  maxAgeMinutes?: number;
  provider?: "kis" | "fred" | "us-treasury" | "bls" | "bea" | "federal-reserve" | "manual" | "configured-api";
  sourceName?: string;
  url?: string;
};

export type MarketSnapshotSource = {
  provider: "kis" | "fred" | "us-treasury" | "bls" | "bea" | "federal-reserve" | "manual" | "configured-api";
  sourceName: string;
  url: string;
  asOf: string;
  collectedAt: string;
  freshness: "fresh" | "stale" | "expired" | "unknown";
  ageMinutes: number;
  maxAgeMinutes: number;
};

export type MarketSnapshotFreshness = {
  status: "fresh" | "stale" | "expired" | "unknown";
  checkedAt: string;
  oldestAsOf?: string;
  staleItems: string[];
};

export type MarketSnapshotDiagnostic = {
  provider: "kis" | "fred" | "official-us" | "system";
  item: string;
  code: string;
  httpStatus?: number;
  recovered?: boolean;
};

export type MarketSnapshot = {
  provider: "manual" | "configured-api" | "kis-fred";
  status: "ready" | "needs_credentials" | "needs_data" | "error";
  marketDate: string;
  collectedAt: string;
  dataQuality: "verified" | "partial" | "missing";
  fallbackUsed?: boolean;
  degradedMode?: "fred_unavailable" | "kis_sector_unavailable" | "kis_overseas_unavailable";
  degradedProviders?: Array<"fred" | "kis-sector" | "kis-overseas">;
  degradedReason?: string;
  disclosures?: string[];
  freshness?: MarketSnapshotFreshness;
  sources?: MarketSnapshotSource[];
  korea?: {
    kospi?: MarketSnapshotMetric;
    kosdaq?: MarketSnapshotMetric;
    investorFlows?: MarketSnapshotMetric[];
    strongSectors?: string[];
    weakSectors?: string[];
  };
  us?: {
    sp500?: MarketSnapshotMetric;
    nasdaq?: MarketSnapshotMetric;
    dow?: MarketSnapshotMetric;
    treasuryYield?: MarketSnapshotMetric;
    fx?: MarketSnapshotMetric;
    leadingSectors?: string[];
  };
  macro?: {
    us2Year?: MarketSnapshotMetric;
    us10Year?: MarketSnapshotMetric;
    yieldSpread10Y2Y?: MarketSnapshotMetric;
  };
  upcoming?: Array<{ date: string; event: string; market?: string; sourceName?: string; url?: string }>;
  diagnostics?: MarketSnapshotDiagnostic[];
  missingItems: string[];
};

export type ReferenceBundle = {
  provider: "mock" | "naver-search" | "manual" | "web";
  mode: "mock" | "real-disabled" | "real";
  status?: ReferenceProviderStatus;
  requiredEnv?: string[];
  contentType: StockReferenceBriefingTemplate;
  generatedAt: string;
  marketDate?: string;
  market: "KR" | "US" | "GLOBAL";
  queries: string[];
  items: ReferenceItem[];
  competitorBlogReferences?: CompetitorBlogReference[];
  competitorAnalysis?: CompetitorBlogAnalysisSummary;
  marketSnapshot?: MarketSnapshot;
  keyThemes: string[];
  repeatedKeywords: string[];
  differentiationPoints: string[];
  cautionNotes: string[];
  sourcePolicy: string;
  summary?: string;
  risks?: string[];
  missingItems?: string[];
};

export type ReferenceSearchInput = {
  topic: string;
  title: string;
  channel: string;
  contentType: StockReferenceBriefingTemplate;
  market: "KR" | "US" | "GLOBAL";
  keywords?: string[];
  maxResults?: number;
  prioritizeInputQueries?: boolean;
};

export type ReferenceAdapter = {
  search(input: ReferenceSearchInput): Promise<ReferenceBundle>;
};

export type BlogImagePrompt = {
  id: string;
  purpose: "thumbnail" | "section" | "inline";
  placement: string;
  title: string;
  prompt: string;
  negativePrompt: string;
  textOverlay?: string;
  aspectRatio?: string;
  notes: string[];
};
