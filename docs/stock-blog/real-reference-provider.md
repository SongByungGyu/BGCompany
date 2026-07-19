# Real stock reference provider

BG Company only permits a real Hermes stock briefing after the reference preflight gate passes. Missing credentials or market data are explicit operating states; the system never fills the gap with invented links or figures.

## Provider modes

- `STOCK_REFERENCE_PROVIDER=mock`: development only. A real Hermes run is blocked.
- `STOCK_REFERENCE_PROVIDER=manual`: reads a curated reference bundle from `STOCK_REFERENCE_MANUAL_JSON` or `STOCK_REFERENCE_MANUAL_PATH`.
- `STOCK_REFERENCE_PROVIDER=naver-search`: calls Naver News and Blog Search only when `REFERENCE_SEARCH_ENABLE_REAL_API=true` and both Naver client credentials exist.

The Naver adapter keeps the original article URL, source name, publication time, collection time, query, and short search summary. When deep competitor analysis is enabled, it opens a bounded number of Naver Blog pages sequentially and stores structure metrics only. Competitor sentences and images are never persisted or copied.

## Required environment variables

```text
REFERENCE_SEARCH_ENABLE_REAL_API=true
NAVER_SEARCH_CLIENT_ID=<secret>
NAVER_SEARCH_CLIENT_SECRET=<secret>
COMPETITOR_BLOG_SEARCH_ENABLED=true
COMPETITOR_BLOG_SEEDS=주간증시,코스피전망,미국증시전망,다음주증시,장전브리핑
COMPETITOR_BLOG_DEEP_ANALYSIS_ENABLED=true
COMPETITOR_BLOG_DEEP_ANALYSIS_REQUIRED=true
COMPETITOR_BLOG_DEEP_ANALYSIS_LIMIT=5
COMPETITOR_BLOG_DEEP_ANALYSIS_TIMEOUT_MS=10000
COMPETITOR_BLOG_DEEP_ANALYSIS_MAX_BYTES=750000
STOCK_MARKET_DATA_PROVIDER=kis-fred
KIS_APP_KEY=<secret>
KIS_APP_SECRET=<secret>
FRED_API_KEY=<secret>
STOCK_MARKET_DATA_ALLOW_MANUAL_FALLBACK=false
STOCK_MARKET_DATA_ALLOW_MANUAL_IN_HERMES=false
```

KIS is restricted to allowlisted quote, investor trend, sector, overseas index, and FX lookup endpoints. Order, balance, account, and position endpoints are not implemented. FRED supplies DGS2, DGS10, and the economic release calendar. Manual MarketSnapshot input remains an emergency-only fallback and is blocked from real Hermes by default.

Never print these values. Only report whether each variable is set.

## Competitor blog structure analysis

Deep analysis measures title length, body length, intro length, paragraph and heading counts, image/link/list/table counts, date-title usage, checklist usage, source sections, investment disclaimers, and calls to action. Results are aggregated into common patterns, averages, differentiation opportunities, and a recommended BG Company article structure.

The analyzer enforces the following boundaries:

- only Naver Blog/Post hosts returned by Naver Search are fetched;
- response bodies are streamed with a per-page byte cap;
- at most five pages are analyzed sequentially;
- scripts, styles, SVG, and raw body sentences are discarded;
- only numeric/boolean structure signals and self-authored observations enter the pipeline;
- fetch failures degrade to search metadata and never trigger copying or mock content.

## Hermes preflight

A real run requires all of the following before any AgentRun or Hermes usage is created:

- five or more unique real references;
- three or more news references;
- three or more distinct publishers;
- at least one official/market-data source or a verified MarketSnapshot;
- three or more competitor blog search results;
- a verified MarketSnapshot with no required missing items;
- no `mock`, placeholder URL, or missing credential state.

Failure returns `needs_credentials`, `needs_reference`, or `needs_data`. It must not consume Hermes/OpenAI usage.

## MarketSnapshot

`MarketSnapshot` is generated automatically from KIS and FRED data for KOSPI/KOSDAQ, investor flows, sector strength, US indices/rates/FX, and upcoming events. Every source records its URL, data timestamp, collection timestamp, age, maximum age, and freshness state. Only `ready + verified + fresh` snapshots pass the real-Hermes gate; missing or stale data is never replaced with mock data. On Saturday and Sunday, KIS freshness may use the configured weekend ceiling for the latest available trading session, while older data remains blocked.

## Self-generated images

Every pipeline can generate cost-free SVG assets under `public/generated/stock-blog/<pipelineId>/`:

- `thumbnail.svg` (1080×1080)
- `market-summary.svg` (1200×675)
- `investor-checklist.svg` (1200×675)

The Docker named volume `bg_company_generated_stock_blog` preserves these files across web container rebuilds. Images contain no third-party logos or copied artwork.

## Naver draft safety

Draft jobs carry image URLs and reference metadata, while `NAVER_ALLOW_IMAGE_UPLOAD=false` and `NAVER_ALLOW_PUBLISH=false` remain the defaults. The local agent verifies body character and line counts after paste. A failed check reports `readability_failed` and stops draft saving. Automatic publishing additionally requires an approved Hermes pipeline, a verified non-fallback MarketSnapshot, generated thumbnail and inline images, `allowPublish=true` in the job, a server-side final duplicate check, and a successful draft save. The first canary is limited to one publish with zero automatic retries.
