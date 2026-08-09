# Automatic paper trading runbook

The production trigger runs at 07:20 KST after the regular US session has closed. A second tick at 07:35 is only a bounded retry. The application event log makes each successful KST date idempotent.

1. Fetch adjusted US daily OHLCV bars through the allowlisted KIS read-only quotation endpoint.
2. Use only bars through the previous completed session to create a frozen chart signal.
3. Simulate a fill at the next session open, including configured slippage and commission.
4. Apply stops before targets because daily OHLC does not reveal intraday ordering.
5. Store virtual signals, orders, fills, trades, positions and a daily snapshot.

The first cycle is baseline-only and never creates retroactive positions. `PAUSED` and `KILLED` accounts do not fetch or trade. Broker order, correction, cancellation, transfer and live credential paths are not implemented.

An optional bounded experiment can be configured with `PAPER_TRIAL_START_DATE` and `PAPER_TRIAL_END_DATE`. Market dates before the start are observed without fills. The end market date is processed normally and the account is then changed to `PAUSED` automatically.

Install the host trigger with `scripts/install-paper-trading-scheduler-cron.sh`. `PAPER_AUTO_SCHEDULER_ENABLED` remains the authoritative application switch.
