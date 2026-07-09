# News Reference Module

Phase 1-S.5 adds a cost-free reference preparation layer for BG Company stock briefing content.

## Goals

- Build briefing-specific search queries before content generation.
- Attach a normalized reference bundle to content-writer and qa-auditor payloads.
- Keep external API calls disabled by default.
- Avoid copying full article bodies or bypassing publisher/copyright rules.

## Data structure

The module stores a `ReferenceBundle` with:

- provider and mode (`mock`, `real-disabled`, `real`)
- briefing template and market
- generated search queries
- reference items
- key themes
- repeated keywords
- differentiation points
- caution notes
- source usage policy

## Adapters

### Mock adapter

Default adapter. It creates sample stock-market reference items without external network calls.

### Naver Search adapter

Skeleton adapter only. It remains disabled unless all of the following are explicitly configured:

- `REFERENCE_SEARCH_PROVIDER=naver-search`
- `REFERENCE_SEARCH_ENABLE_REAL_API=true`
- `NAVER_SEARCH_CLIENT_ID`
- `NAVER_SEARCH_CLIENT_SECRET`

If disabled, it returns an empty `real-disabled` reference bundle and does not call Naver Search.

## Safety policy

- No external news API call by default.
- No stock trading or order API.
- No article full-text scraping.
- No automatic Naver Blog publishing.
- References are used only for topic planning, differentiation, and caution notes.
