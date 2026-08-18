# Stock Blog Scheduler

Phase 1-S scheduler prepares stock-market blog drafts on a fixed KST schedule.

## Schedule

| Content type | Cadence | Time |
|---|---:|---:|
| KOREA_DAILY_PREVIEW | Weekdays | 07:20 KST generation start, publish before 08:20 KST |
| KOREA_MARKET_CLOSE_US_PREVIEW | Weekdays | 17:00 KST |
| WEEKLY_MARKET_REVIEW | Saturday | 09:00 KST |
| INVESTMENT_STUDY | Tuesday fixed | 12:10 KST, verified upcoming schedule/search question |
| INVESTMENT_STUDY | Thursday fixed | 12:10 KST, announcement result/practical question |
| INVESTMENT_STUDY | Monday, Wednesday, or Friday conditional | 12:10 KST, only one extra post per week when the issue score passes |
| NEXT_WEEK_MARKET_PREVIEW | Sunday | 19:00 KST, main issues/sectors + next-week schedule |
| LARGE_CAP_DISCLOSURE_EARNINGS | Weekdays | 18:30 KST, only when an official OpenDART/SEC event exists |

## Flow

```text
cron tick
→ POST /api/stock-blog/scheduler
→ check due schedule and duplicate EventLog
→ check KRX and NYSE sessions; replace a closed market preview with one date-level search-intent investment-study post, or persist `deferred` when KRX status is unavailable
→ for disclosure/earnings, scan official OpenDART/SEC events and stop without generation when none exist
→ for investment study, collect current references; Tuesday selects a verified upcoming event question, Thursday selects a result/practical question, and conditional slots stop when the issue score is below the threshold
→ check Hermes remaining count when runnerMode=hermes
→ start content pipeline
→ auto approve Director request
→ create NaverDraftJob
→ Local Naver Draft Agent saves or publishes according to the approved auto-publish flags
```

Auto-publish remains separately controlled by `STOCK_BLOG_SCHEDULER_AUTO_PUBLISH`. Duplicate publish keys, quality gates, safe retry limits, and the publish circuit breaker continue to apply.

## Environment

```env
STOCK_BLOG_SCHEDULER_ENABLED=false
STOCK_BLOG_SCHEDULER_TZ=Asia/Seoul
STOCK_BLOG_SCHEDULER_RUNNER_MODE=mock
STOCK_BLOG_SCHEDULER_AUTO_APPROVE=true
STOCK_BLOG_SCHEDULER_AUTO_CREATE_DRAFT=true
STOCK_BLOG_SCHEDULER_LOOKBACK_MINUTES=180
STOCK_BLOG_LARGE_CAP_EVENTS_ENABLED=false
STOCK_BLOG_WEEKDAY_INVESTMENT_STUDY_ENABLED=false
KIS_HOLIDAY_MAX_AGE_MINUTES=10080
STOCK_BLOG_KRX_CLOSED_DATES=
STOCK_BLOG_KRX_OPEN_DATES=
STOCK_BLOG_US_CLOSED_DATES=
STOCK_BLOG_US_OPEN_DATES=
DART_API_KEY=
SEC_EDGAR_USER_AGENT=BGCompany/1.0 bgcompanyoffice.cloud
```

Keep the scheduler disabled until the operator confirms Hermes/OpenAI cost policy and the local Naver Draft Agent is stable.

## API

Admin status:

```bash
curl https://bgcompanyoffice.cloud/api/stock-blog/scheduler
```

Cron tick:

```bash
curl -X POST https://bgcompanyoffice.cloud/api/stock-blog/scheduler \
  -H "x-bg-agent-key: $AGENT_API_KEY"
```

## VPS cron example

Run every 10 minutes. The service itself decides whether a schedule is due and prevents duplicate runs for the same slot.

```cron
*/10 * * * * cd /opt/bg-company && set -a && . ./.env && set +a && curl -fsS -X POST https://bgcompanyoffice.cloud/api/stock-blog/scheduler -H "x-bg-agent-key: $AGENT_API_KEY" >> logs/stock-blog-scheduler.log 2>&1
```

## Safety

- Do not increase `HERMES_DAILY_RUN_LIMIT` without explicit approval.
- Do not run Hermes smoke tests from cron.
- Do not generate a disclosure/earnings article unless an official OpenDART or SEC filing is present.
- Do not generate the conditional investment-study article unless verified market data is fresh and the issue score passes; allow at most one conditional study post per week.
- Do not treat an exchange holiday as a failed run. Replace the closed market preview with a verified search-intent investment-study post about the holiday, next open date, and trading/order hours; never catch up the skipped preview on the next day.
- Use `INVESTMENT_STUDY_HOLIDAY:<marketDate>` as the date-level publish key so KRX and NYSE closures on the same day cannot create two holiday replacement posts.
- Do not substitute zero-valued investor flow for a closed KRX session. Use the last confirmed session and its exact as-of date.
- Do not store Naver login cookies on the server.
- Do not commit `.env` or print secrets.


## Helper scripts

Install cron:

```bash
bash scripts/install-stock-blog-scheduler-cron.sh
```

Check scheduler:

```bash
bash scripts/check-stock-blog-scheduler.sh
```
