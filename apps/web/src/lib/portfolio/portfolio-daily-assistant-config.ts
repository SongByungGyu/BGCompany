export type PortfolioDailyAssistantConfig = {
  assistantEnabled: boolean;
  snapshotEnabled: boolean;
  attributionEnabled: boolean;
  reportMode: "rules";
  retentionDays: number;
  alertPricePercent: number;
  alertSyncFailure: boolean;
  timezone: "Asia/Seoul";
};

function enabled(value: string | undefined) {
  return value?.trim().toLowerCase() === "true";
}

function boundedNumber(value: string | undefined, fallback: number, minimum: number, maximum: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(minimum, Math.min(parsed, maximum)) : fallback;
}

export function getPortfolioDailyAssistantConfig(env: Partial<NodeJS.ProcessEnv> = process.env): PortfolioDailyAssistantConfig {
  return {
    assistantEnabled: enabled(env.PORTFOLIO_DAILY_ASSISTANT_ENABLED),
    snapshotEnabled: enabled(env.PORTFOLIO_DAILY_SNAPSHOT_ENABLED),
    attributionEnabled: enabled(env.PORTFOLIO_CHANGE_ATTRIBUTION_ENABLED),
    reportMode: "rules",
    retentionDays: boundedNumber(env.PORTFOLIO_DAILY_SNAPSHOT_RETENTION_DAYS, 730, 30, 3650),
    alertPricePercent: boundedNumber(env.PORTFOLIO_DAILY_ALERT_PRICE_PERCENT, 5, 0.1, 100),
    alertSyncFailure: env.PORTFOLIO_DAILY_ALERT_SYNC_FAILURE?.trim().toLowerCase() !== "false",
    timezone: "Asia/Seoul",
  };
}
