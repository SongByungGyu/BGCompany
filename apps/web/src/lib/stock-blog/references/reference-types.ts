export type StockReferenceBriefingTemplate =
  | "KOREA_DAILY_PREVIEW"
  | "KOREA_MARKET_CLOSE_US_PREVIEW"
  | "WEEKLY_MARKET_REVIEW"
  | "NEXT_WEEK_MARKET_PREVIEW";

export type ReferenceSourceType = "news" | "blog" | "disclosure" | "market_data" | "manual";

export type ReferenceItem = {
  id: string;
  sourceType: ReferenceSourceType;
  provider: string;
  title: string;
  url?: string;
  publisher?: string;
  publishedAt?: string;
  summary?: string;
  query?: string;
  keywords?: string[];
  relevanceScore?: number;
  usageNote?: string;
  copyrightPolicy?: string;
};

export type ReferenceBundle = {
  provider: "mock" | "naver-search" | "manual";
  mode: "mock" | "real-disabled" | "real";
  contentType: StockReferenceBriefingTemplate;
  generatedAt: string;
  market: "KR" | "US" | "GLOBAL";
  queries: string[];
  items: ReferenceItem[];
  keyThemes: string[];
  repeatedKeywords: string[];
  differentiationPoints: string[];
  cautionNotes: string[];
  sourcePolicy: string;
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
