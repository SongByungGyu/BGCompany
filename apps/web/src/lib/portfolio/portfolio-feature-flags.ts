export function isPortfolioMonitoringEnabled(environment: Record<string, string | undefined>) {
  return environment.PORTFOLIO_MONITORING_ENABLED === "true";
}

