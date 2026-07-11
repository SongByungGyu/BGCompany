export type StockReferenceBriefingTemplate =
  | "KOREA_DAILY_PREVIEW"
  | "KOREA_MARKET_CLOSE_US_PREVIEW"
  | "WEEKLY_MARKET_REVIEW"
  | "NEXT_WEEK_MARKET_PREVIEW";

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
};

export type MarketSnapshotMetric = {
  label: string;
  value?: number | string;
  changePct?: number;
  direction?: "up" | "down" | "flat" | "mixed";
  asOf?: string;
  sourceName?: string;
  url?: string;
};

export type MarketSnapshot = {
  provider: "manual" | "configured-api";
  status: "ready" | "needs_credentials" | "needs_data" | "error";
  marketDate: string;
  collectedAt: string;
  dataQuality: "verified" | "partial" | "missing";
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
  upcoming?: Array<{ date: string; event: string; market?: string; sourceName?: string; url?: string }>;
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
