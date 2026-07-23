import "server-only";
import type { PortfolioDashboard, PortfolioReportType } from "./portfolio-types";

export type GeneratedPortfolioReport = {
  reportType: PortfolioReportType;
  summary: string;
  body: string;
  dataQuality: string;
  status: "ready";
};

export interface PortfolioReportWriter {
  readonly mode: "rules" | "hermes";
  generate(dashboard: PortfolioDashboard): Promise<GeneratedPortfolioReport[]>;
}

function list(values: string[], empty: string) {
  return values.length ? values.join(", ") : empty;
}

export const ruleBasedPortfolioReportWriter: PortfolioReportWriter = {
  mode: "rules",
  async generate(dashboard) {
    const highRisks = dashboard.risks.filter((risk) => risk.severity === "high").map((risk) => risk.title);
    const warningRisks = dashboard.risks.filter((risk) => risk.severity === "warning").map((risk) => risk.title);
    const dividendStatus = dashboard.dividends.reduce<Record<string, number>>((counts, event) => {
      counts[event.status] = (counts[event.status] ?? 0) + 1;
      return counts;
    }, {});
    const dividendCurrencies = Array.from(new Set(dashboard.dividends.map((event) => event.currency)));
    const volatile = dashboard.holdings
      .filter((holding) => Math.abs(Number(holding.price.changePercent ?? 0)) >= 5 || Math.abs(Number(holding.price.weeklyChangePercent ?? 0)) >= 10)
      .map((holding) => holding.holding.name);
    const missing = dashboard.summary.missingItems;
    return [
      {
        reportType: "DAILY",
        summary: dashboard.briefing,
        body: `${dashboard.briefing} 큰 변동 종목: ${list(volatile, "없음")}. 데이터 확인 항목: ${list(missing, "없음")}.`,
        dataQuality: dashboard.summary.dataQuality,
        status: "ready",
      },
      {
        reportType: "WEEKLY",
        summary: `주간 확인 신호는 고위험 ${highRisks.length}건, 경고 ${warningRisks.length}건입니다.`,
        body: `종목·섹터 비중과 주간 변동성을 규칙으로 확인했습니다. 주요 신호: ${list([...highRisks, ...warningRisks], "없음")}. 다음 배당 일정은 ${dashboard.dividends.length}건입니다.`,
        dataQuality: dashboard.summary.dataQuality,
        status: "ready",
      },
      {
        reportType: "DIVIDEND",
        summary: `배당 일정 ${dashboard.dividends.length}건을 상태별로 구분했습니다.`,
        body: `확정 ${dividendStatus.confirmed ?? 0}건, 발표 ${dividendStatus.announced ?? 0}건, 추정 ${dividendStatus.estimated ?? 0}건, 과거 ${dividendStatus.historical ?? 0}건, 미확인 ${dividendStatus.unavailable ?? 0}건입니다. 통화: ${list(dividendCurrencies, "없음")}.`,
        dataQuality: dashboard.summary.dataQuality,
        status: "ready",
      },
      {
        reportType: "RISK",
        summary: `고위험 ${highRisks.length}건과 경고 ${warningRisks.length}건을 확인했습니다.`,
        body: `고위험: ${list(highRisks, "없음")}. 경고: ${list(warningRisks, "없음")}. 데이터 누락: ${list(missing, "없음")}. 이 보고서는 매매 지시가 아닌 확인 자료입니다.`,
        dataQuality: dashboard.summary.dataQuality,
        status: "ready",
      },
    ];
  },
};

