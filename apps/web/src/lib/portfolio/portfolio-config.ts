import "server-only";
import { isPortfolioMonitoringEnabled } from "./portfolio-feature-flags";
export { PORTFOLIO_RISK_THRESHOLDS } from "./portfolio-risk-thresholds";

export const PORTFOLIO_TEAM = [
  { id: "portfolio-data-collector", role: "시세·시장 데이터 정규화", status: "대기" },
  { id: "dividend-monitor", role: "배당 상태·일정 확인", status: "대기" },
  { id: "news-risk-monitor", role: "뉴스·공시 위험 신호 분류", status: "대기" },
  { id: "portfolio-report-writer", role: "규칙 기반 브리핑 작성", status: "대기" },
  { id: "portfolio-qa-auditor", role: "수치·시각·표현 검증", status: "대기" },
] as const;

function positiveInteger(value: string | undefined, fallback: number, maximum: number) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(parsed, maximum)) : fallback;
}

export function portfolioConfig() {
  return {
    enabled: isPortfolioMonitoringEnabled(process.env),
    priceProvider: process.env.PORTFOLIO_PRICE_PROVIDER?.trim() === "kis" ? "kis" as const : "mock" as const,
    accountSyncProvider: process.env.PORTFOLIO_ACCOUNT_SYNC_PROVIDER?.trim() === "toss" ? "toss" as const : "none" as const,
    accountSyncEnabled: process.env.PORTFOLIO_ACCOUNT_SYNC_ENABLED === "true",
    newsEnabled: process.env.PORTFOLIO_NEWS_ENABLED === "true",
    dividendEnabled: process.env.PORTFOLIO_DIVIDEND_ENABLED === "true",
    reportMode: process.env.PORTFOLIO_REPORT_MODE?.trim() === "hermes" ? "hermes" as const : "rules" as const,
    autoRefreshEnabled: process.env.PORTFOLIO_AUTO_REFRESH_ENABLED === "true",
    maxSymbols: positiveInteger(process.env.PORTFOLIO_MAX_SYMBOLS, 50, 200),
    priceCacheMinutes: positiveInteger(process.env.PORTFOLIO_PRICE_CACHE_MINUTES, 15, 1440),
  };
}
