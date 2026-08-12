export type PaperTradingTeamRole = "LEAD_ANALYST" | "RISK_MANAGER" | "EXECUTION_REVIEWER";

export type PaperTradingTeamAnalysisInput = {
  marketDate: string;
  initialCapitalKrw: number;
  cashKrw: number;
  equityKrw: number;
  marketValueKrw: number;
  openPositions: number;
  acceptedSignals: number;
  rejectedSignals: number;
  filledOrders: number;
  rejectedOrders: number;
  fills: number;
  riskEventCount: number;
  highRiskEventCount: number;
  configuredSlippageBps: number;
  averageSlippageBps: number;
};

export type PaperTradingTeamReviewDraft = {
  role: PaperTradingTeamRole;
  reviewType: string;
  recommendation: string;
  confidence: number;
  summary: string;
  details: Record<string, string | number | boolean>;
};

function percent(numerator: number, denominator: number) {
  return denominator > 0 ? numerator / denominator * 100 : 0;
}

export function buildPaperTradingTeamReviewDrafts(input: PaperTradingTeamAnalysisInput): PaperTradingTeamReviewDraft[] {
  const exposurePercent = percent(input.marketValueKrw, input.equityKrw);
  const cashPercent = percent(input.cashKrw, input.equityKrw);
  const returnPercent = percent(input.equityKrw - input.initialCapitalKrw, input.initialCapitalKrw);
  const totalSignals = input.acceptedSignals + input.rejectedSignals;
  const executionMismatch = input.filledOrders !== input.fills;
  const slippageExceeded = input.fills > 0 && input.averageSlippageBps > input.configuredSlippageBps + 0.1;

  return [
    {
      role: "LEAD_ANALYST",
      reviewType: "SIGNAL_AND_STRATEGY",
      recommendation: input.acceptedSignals > 0 ? "FOLLOW_LOCKED_PLAN" : "HOLD_EXISTING_PLAN",
      confidence: totalSignals > 0 ? 88 : 72,
      summary: input.acceptedSignals > 0
        ? `${input.marketDate} 전략 신호 ${totalSignals}건 중 ${input.acceptedSignals}건이 채택됐습니다. 분기 고정 계획을 유지합니다.`
        : `${input.marketDate} 신규 채택 신호가 없어 기존 분기 계획과 보유 포지션을 유지합니다.`,
      details: {
        acceptedSignals: input.acceptedSignals,
        rejectedSignals: input.rejectedSignals,
        openPositions: input.openPositions,
        accountReturnPercent: Number(returnPercent.toFixed(4)),
      },
    },
    {
      role: "RISK_MANAGER",
      reviewType: "RISK_AND_EXPOSURE",
      recommendation: input.highRiskEventCount > 0 || exposurePercent > 80 ? "RISK_REVIEW_REQUIRED" : "RISK_CLEAR",
      confidence: input.highRiskEventCount > 0 ? 95 : 90,
      summary: input.highRiskEventCount > 0
        ? `${input.marketDate} 고위험 이벤트 ${input.highRiskEventCount}건이 있어 다음 가상 주문 전 재검토가 필요합니다.`
        : `${input.marketDate} 총 노출 ${exposurePercent.toFixed(2)}%, 현금 ${cashPercent.toFixed(2)}%로 현재 모의 한도 안입니다.`,
      details: {
        exposurePercent: Number(exposurePercent.toFixed(4)),
        cashPercent: Number(cashPercent.toFixed(4)),
        riskEventCount: input.riskEventCount,
        highRiskEventCount: input.highRiskEventCount,
        openPositions: input.openPositions,
      },
    },
    {
      role: "EXECUTION_REVIEWER",
      reviewType: "EXECUTION_AND_AUDIT",
      recommendation: executionMismatch || slippageExceeded ? "EXECUTION_REVIEW_REQUIRED" : input.filledOrders > 0 ? "EXECUTION_OK" : "NO_NEW_EXECUTION",
      confidence: executionMismatch ? 98 : input.filledOrders > 0 ? 92 : 80,
      summary: executionMismatch
        ? `${input.marketDate} 가상 주문 ${input.filledOrders}건과 체결 ${input.fills}건이 일치하지 않아 감사 확인이 필요합니다.`
        : input.filledOrders > 0
          ? `${input.marketDate} 가상 주문·체결 ${input.fills}건을 확인했고 평균 슬리피지는 ${input.averageSlippageBps.toFixed(2)}bp입니다.`
          : `${input.marketDate} 신규 가상 체결은 없으며 기존 포지션의 일일 평가만 확인했습니다.`,
      details: {
        filledOrders: input.filledOrders,
        rejectedOrders: input.rejectedOrders,
        fills: input.fills,
        executionMismatch,
        configuredSlippageBps: input.configuredSlippageBps,
        averageSlippageBps: Number(input.averageSlippageBps.toFixed(4)),
        slippageExceeded,
      },
    },
  ];
}
