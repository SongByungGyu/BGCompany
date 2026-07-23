# KIS real-account read-only holdings sync

## Scope

- Reads domestic holdings with `GET /uapi/domestic-stock/v1/trading/inquire-balance` (`TTTC8434R`).
- Reads overseas holdings with `GET /uapi/overseas-stock/v1/trading/inquire-balance` (`TTTS3012R`).
- Does not implement order, correction/cancel, transfer, orderable-cash, or trade-history endpoints.
- Stores only a SHA-256-derived account reference and a masked account label. The full account number remains in the VPS environment file.
- Sync is manual and admin-session protected. It is limited to three requests per minute.

Official reference:

- https://github.com/koreainvestment/open-trading-api/tree/main/examples_llm/domestic_stock/inquire_balance
- https://github.com/koreainvestment/open-trading-api/tree/main/examples_llm/overseas_stock/inquire_balance

## Required production configuration

```dotenv
PORTFOLIO_MONITORING_ENABLED=true
PORTFOLIO_PRICE_PROVIDER=kis
PORTFOLIO_ACCOUNT_SYNC_ENABLED=true
KIS_ACCOUNT_NUMBER=12345678
KIS_ACCOUNT_PRODUCT_CODE=01
KIS_ACCOUNT_LABEL=한국투자증권 실계좌
KIS_ACCOUNT_MARKETS=KR,US
```

`KIS_ACCOUNT_NUMBER` is the first eight digits, and `KIS_ACCOUNT_PRODUCT_CODE` is the final two digits of the KIS account number. Never commit or paste the real values into source control, issues, logs, or chat.

## Rollout

1. Back up PostgreSQL and the VPS `.env`.
2. Apply the additive Prisma schema.
3. Deploy with `PORTFOLIO_ACCOUNT_SYNC_ENABLED=false`.
4. Add the account number and product code directly to the VPS `.env`.
5. Set `PORTFOLIO_ACCOUNT_SYNC_ENABLED=true` and recreate only the web container.
6. Sign in as admin and run **실계좌 동기화** once.
7. Confirm that the KIS account row contains only a masked label and that no order endpoints appear in web logs.

## Rollback

Set `PORTFOLIO_ACCOUNT_SYNC_ENABLED=false` and recreate the web container. Synced holdings remain as audit data but cannot be refreshed. No trading state exists to unwind.
