# Real stock reference provider

BG Company only permits a real Hermes stock briefing after the reference preflight gate passes. Missing credentials or market data are explicit operating states; the system never fills the gap with invented links or figures.

## Provider modes

- `STOCK_REFERENCE_PROVIDER=mock`: development only. A real Hermes run is blocked.
- `STOCK_REFERENCE_PROVIDER=manual`: reads a curated reference bundle from `STOCK_REFERENCE_MANUAL_JSON` or `STOCK_REFERENCE_MANUAL_PATH`.
- `STOCK_REFERENCE_PROVIDER=naver-search`: calls Naver News and Blog Search only when `REFERENCE_SEARCH_ENABLE_REAL_API=true` and both Naver client credentials exist.

The Naver adapter keeps the original article URL, source name, publication time, collection time, query, and short search summary. It does not copy full competitor articles or images.

## Required environment variables

```text
REFERENCE_SEARCH_ENABLE_REAL_API=true
NAVER_SEARCH_CLIENT_ID=<secret>
NAVER_SEARCH_CLIENT_SECRET=<secret>
COMPETITOR_BLOG_SEARCH_ENABLED=true
STOCK_MARKET_DATA_PROVIDER=manual|api
```

For manual market data, provide `STOCK_MARKET_SNAPSHOT_JSON` or a file at `STOCK_MARKET_SNAPSHOT_PATH`. For an API adapter, also configure an HTTPS `STOCK_MARKET_DATA_API_URL` and `STOCK_MARKET_DATA_API_KEY`.

Never print these values. Only report whether each variable is set.

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

`MarketSnapshot` is a date-stamped structured object for KOSPI/KOSDAQ, investor flows, sector strength, US indices/rates/FX, and upcoming events. Manual data must be reviewed before setting `dataQuality=verified`. A configured API response must use the same structure.

## Self-generated images

Every pipeline can generate cost-free SVG assets under `public/generated/stock-blog/<pipelineId>/`:

- `thumbnail.svg` (1080×1080)
- `market-summary.svg` (1200×675)
- `investor-checklist.svg` (1200×675)

The Docker named volume `bg_company_generated_stock_blog` preserves these files across web container rebuilds. Images contain no third-party logos or copied artwork.

## Naver draft safety

Draft jobs carry image URLs and reference metadata, but `NAVER_ALLOW_IMAGE_UPLOAD=false` remains the default. The local agent verifies body character and line counts after paste. A failed check reports `readability_failed` and stops draft saving. Final publishing remains manual.
