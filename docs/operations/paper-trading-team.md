# Paper Trading Team Operations

## Current storage

Paper trading is isolated from real portfolio holdings and broker accounts.

- `PaperTradingAccount`: virtual KRW account and locked strategy rules
- `PaperTradingPosition`, `PaperTradingSignal`, `PaperTradingOrder`, `PaperTradingFill`, `PaperTradingTrade`: virtual trading ledger
- `PaperTradingSnapshot`, `PaperTradingRiskEvent`: daily valuation and safety audit
- `PaperTradingTeamMember`: paper account-to-employee assignment and authority flags
- `PaperTradingTeamReview`: one independent role review per market date

`PaperTradingTrade` only contains closed positions. Open virtual holdings remain in `PaperTradingPosition`, so a zero trade count does not mean that the account has never executed a virtual fill.

## Three-person desk

| Employee | Role | Responsibility |
| --- | --- | --- |
| 서준 (`stock-monitor`) | `LEAD_ANALYST` | Locked quarterly plan, candidate signals, and market-state review |
| 민서 (`risk-trader`) | `RISK_MANAGER` | Cash, exposure, position limits, and high-risk event review |
| 태오 (`execution-trader`) | `EXECUTION_REVIEWER` | Virtual orders, fills, slippage, and performance audit |

All three members are created with these fixed application-level boundaries:

- `canAnalyze=true`
- `canApproveVirtualOrder=false`
- `canSubmitBrokerOrder=false`
- team operating mode `OBSERVE_ONLY`
- paper account external authorization `NONE`
- paper account execution venue `INTERNAL_VIRTUAL_BROKER`

The team must not be reused as a live-trading authority. A future broker integration requires a separate design review, credentials boundary, approval workflow, kill switch, reconciliation process, and explicit production authorization.

## Daily workflow

1. The existing paper scheduler loads read-only market data and runs the virtual cycle.
2. Strategy, risk, and execution reviews are computed independently from the stored cycle records.
3. Each review is upserted by account, member, market date, and review type.
4. Stable start/output events update the employee, task, timeline, and office state.
5. Review failure writes `TEAM_REVIEW_FAILED` but does not roll back or repeat a completed virtual trading cycle.

The review process is idempotent for a market date. Re-running it refreshes the stored conclusion without duplicating the stable audit events.

## Office UI linkage

The employee API returns each employee's explicit `currentTaskId` task first, then falls back to the newest active assigned task. The office view uses the stored task title, progress, model, cost, recent output, next action, error, and current location. Event side effects keep task status, employee status, and office location synchronized.

The market room contains three assigned seats:

- `stock-seat-01`: 서준
- `stock-seat-02`: 민서
- `stock-seat-03`: 태오

## Operational checks

After an additive schema deployment, initialize the team once for the active paper account through the authenticated `POST /api/portfolio/paper` action `initialize-team`. If the account has a last market date, this also backfills the latest three reviews.

Confirm in the database:

```sql
select "employeeId", role, "canAnalyze", "canApproveVirtualOrder", "canSubmitBrokerOrder"
from "PaperTradingTeamMember"
order by "displayOrder";

select "marketDate", "reviewType", recommendation, confidence, status
from "PaperTradingTeamReview"
order by "marketDate" desc, "reviewType";
```

Expected safety result: every `canSubmitBrokerOrder` and `canApproveVirtualOrder` value is `false`.
