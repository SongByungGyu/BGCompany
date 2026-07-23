import { Prisma } from "@prisma/client";
import type { DividendStatus, FreshnessStatus, PortfolioCurrency, PortfolioMarket, RiskSeverity } from "./portfolio-types.ts";
import { PORTFOLIO_RISK_THRESHOLDS } from "./portfolio-risk-thresholds.ts";

export type DecimalInput = Prisma.Decimal | string | number;

export type CalculationHolding = {
  id: string;
  market: PortfolioMarket;
  symbol: string;
  name: string;
  sector: string;
  currency: PortfolioCurrency;
  quantity: DecimalInput;
  averagePrice: DecimalInput;
};

export type CalculationQuote = {
  price: DecimalInput | null;
  changePercent?: DecimalInput | null;
  weeklyChangePercent?: DecimalInput | null;
  freshnessStatus: FreshnessStatus;
};

export type CalculatedHolding = {
  holding: CalculationHolding;
  nativeMarketValue: Prisma.Decimal | null;
  nativeCostBasis: Prisma.Decimal;
  nativeProfitLoss: Prisma.Decimal | null;
  baseMarketValue: Prisma.Decimal | null;
  baseCostBasis: Prisma.Decimal | null;
  baseProfitLoss: Prisma.Decimal | null;
  returnPercent: Prisma.Decimal | null;
  weightPercent: Prisma.Decimal | null;
  provisional: boolean;
  missingItems: string[];
};

export type CalculatedRisk = {
  holdingId: string | null;
  type: string;
  severity: RiskSeverity;
  title: string;
  message: string;
};

const ZERO = new Prisma.Decimal(0);
const HUNDRED = new Prisma.Decimal(100);

export function decimal(value: DecimalInput) {
  return value instanceof Prisma.Decimal ? value : new Prisma.Decimal(value);
}

export function percent(numerator: Prisma.Decimal, denominator: Prisma.Decimal) {
  return denominator.isZero() ? ZERO : numerator.div(denominator).mul(HUNDRED);
}

export function calculateHolding(
  holding: CalculationHolding,
  quote: CalculationQuote,
  baseCurrency: PortfolioCurrency,
  usdKrwRate?: DecimalInput | null,
): CalculatedHolding {
  const quantity = decimal(holding.quantity);
  const averagePrice = decimal(holding.averagePrice);
  const nativeCostBasis = averagePrice.mul(quantity);
  const missingItems: string[] = [];
  const exchangeRate = usdKrwRate == null ? null : decimal(usdKrwRate);
  if (quote.price == null || quote.freshnessStatus === "unavailable") {
    missingItems.push(`${holding.symbol} 현재가`);
    return {
      holding,
      nativeMarketValue: null,
      nativeCostBasis,
      nativeProfitLoss: null,
      baseMarketValue: null,
      baseCostBasis: holding.currency === baseCurrency ? nativeCostBasis : null,
      baseProfitLoss: null,
      returnPercent: null,
      weightPercent: null,
      provisional: true,
      missingItems,
    };
  }
  const currentPrice = decimal(quote.price);
  const nativeMarketValue = currentPrice.mul(quantity);
  const nativeProfitLoss = nativeMarketValue.sub(nativeCostBasis);
  const returnPercent = percent(nativeProfitLoss, nativeCostBasis);
  let baseMarketValue: Prisma.Decimal | null = nativeMarketValue;
  let baseCostBasis: Prisma.Decimal | null = nativeCostBasis;
  if (holding.currency !== baseCurrency) {
    if (holding.currency === "USD" && baseCurrency === "KRW" && exchangeRate) {
      baseMarketValue = nativeMarketValue.mul(exchangeRate);
      baseCostBasis = nativeCostBasis.mul(exchangeRate);
    } else {
      baseMarketValue = null;
      baseCostBasis = null;
      missingItems.push(`${holding.currency}/${baseCurrency} 환율`);
    }
  }
  return {
    holding,
    nativeMarketValue,
    nativeCostBasis,
    nativeProfitLoss,
    baseMarketValue,
    baseCostBasis,
    baseProfitLoss: baseMarketValue && baseCostBasis ? baseMarketValue.sub(baseCostBasis) : null,
    returnPercent,
    weightPercent: null,
    provisional: quote.freshnessStatus !== "fresh" || baseMarketValue == null,
    missingItems,
  };
}

export function applyPortfolioWeights(values: CalculatedHolding[]) {
  const total = values.reduce((sum, value) => value.baseMarketValue ? sum.add(value.baseMarketValue) : sum, ZERO);
  return values.map((value) => ({
    ...value,
    weightPercent: value.baseMarketValue && !total.isZero() ? percent(value.baseMarketValue, total) : null,
  }));
}

export function allocationBy(
  values: CalculatedHolding[],
  keyOf: (value: CalculatedHolding) => string,
) {
  const totals = new Map<string, Prisma.Decimal>();
  for (const value of values) {
    if (!value.baseMarketValue) continue;
    const key = keyOf(value) || "미분류";
    totals.set(key, (totals.get(key) ?? ZERO).add(value.baseMarketValue));
  }
  const total = Array.from(totals.values()).reduce((sum, value) => sum.add(value), ZERO);
  return Array.from(totals, ([key, value]) => ({
    key,
    value,
    weightPercent: percent(value, total),
  })).sort((left, right) => right.value.comparedTo(left.value));
}

function severity(value: Prisma.Decimal, warning: number, high: number): RiskSeverity | null {
  if (value.greaterThanOrEqualTo(high)) return "high";
  if (value.greaterThanOrEqualTo(warning)) return "warning";
  return null;
}

export function evaluatePortfolioRisks(
  values: CalculatedHolding[],
  quotes: Map<string, CalculationQuote>,
  options: { exchangeRateFreshness?: FreshnessStatus; dividendUnavailableSymbols?: Set<string>; newsMissingSymbols?: Set<string> } = {},
) {
  const risks: CalculatedRisk[] = [];
  for (const value of values) {
    if (value.weightPercent) {
      const level = severity(value.weightPercent, PORTFOLIO_RISK_THRESHOLDS.holdingWarningPercent, PORTFOLIO_RISK_THRESHOLDS.holdingHighPercent);
      if (level) risks.push({
        holdingId: value.holding.id,
        type: "holding_concentration",
        severity: level,
        title: `${value.holding.name} 종목 집중`,
        message: `해당 종목의 포트폴리오 비중이 ${value.weightPercent.toDecimalPlaces(1).toString()}%로 높습니다. 가격 변동이 전체 평가금액에 미치는 영향을 확인할 필요가 있습니다.`,
      });
    }
    const quote = quotes.get(`${value.holding.market}:${value.holding.symbol}`);
    if (!quote || quote.freshnessStatus === "stale" || quote.freshnessStatus === "unavailable") risks.push({
      holdingId: value.holding.id,
      type: "price_freshness",
      severity: quote?.freshnessStatus === "unavailable" ? "high" : "warning",
      title: `${value.holding.name} 시세 확인 필요`,
      message: "시세 기준 시각이 오래되었거나 조회할 수 없어 평가금액을 잠정값으로 표시합니다.",
    });
    const daily = quote?.changePercent == null ? null : decimal(quote.changePercent).abs();
    if (daily?.greaterThanOrEqualTo(PORTFOLIO_RISK_THRESHOLDS.dailyVolatilityPercent)) risks.push({
      holdingId: value.holding.id,
      type: "daily_volatility",
      severity: "warning",
      title: `${value.holding.name} 일간 변동성`,
      message: `일간 변동률 절대값이 ${daily.toDecimalPlaces(2).toString()}%입니다. 변동 원인과 포트폴리오 영향을 확인할 필요가 있습니다.`,
    });
    const weekly = quote?.weeklyChangePercent == null ? null : decimal(quote.weeklyChangePercent).abs();
    if (weekly?.greaterThanOrEqualTo(PORTFOLIO_RISK_THRESHOLDS.weeklyVolatilityPercent)) risks.push({
      holdingId: value.holding.id,
      type: "weekly_volatility",
      severity: "warning",
      title: `${value.holding.name} 주간 변동성`,
      message: `주간 변동률 절대값이 ${weekly.toDecimalPlaces(2).toString()}%입니다. 최근 변동 요인을 확인할 필요가 있습니다.`,
    });
    if (options.dividendUnavailableSymbols?.has(value.holding.symbol)) risks.push({
      holdingId: value.holding.id,
      type: "dividend_unavailable",
      severity: "info",
      title: `${value.holding.name} 배당 정보 미확인`,
      message: "배당 정보 공급원이 없거나 확인되지 않았습니다. 확정 일정으로 해석하지 마세요.",
    });
    if (options.newsMissingSymbols?.has(value.holding.symbol)) risks.push({
      holdingId: value.holding.id,
      type: "news_insufficient",
      severity: "info",
      title: `${value.holding.name} 뉴스 정보 부족`,
      message: "최근 뉴스 참고자료가 충분하지 않습니다. 공시와 공식 발표를 별도로 확인할 필요가 있습니다.",
    });
  }
  for (const allocation of allocationBy(values, (value) => value.holding.sector || "미분류")) {
    const level = severity(allocation.weightPercent, PORTFOLIO_RISK_THRESHOLDS.sectorWarningPercent, PORTFOLIO_RISK_THRESHOLDS.sectorHighPercent);
    if (level) risks.push({
      holdingId: null,
      type: "sector_concentration",
      severity: level,
      title: `${allocation.key} 섹터 집중`,
      message: `${allocation.key} 섹터 비중이 ${allocation.weightPercent.toDecimalPlaces(1).toString()}%입니다. 해당 업종 변동이 전체 포트폴리오에 미치는 영향을 확인할 필요가 있습니다.`,
    });
  }
  if (options.exchangeRateFreshness === "stale" || options.exchangeRateFreshness === "unavailable") risks.push({
    holdingId: null,
    type: "exchange_rate_freshness",
    severity: options.exchangeRateFreshness === "unavailable" ? "high" : "warning",
    title: "환율 기준 시각 확인 필요",
    message: "USD/KRW 환율이 오래되었거나 누락되어 원화 환산 금액을 확정값으로 볼 수 없습니다.",
  });
  return risks;
}

export function annualDividend(quantity: DecimalInput, amountPerShare: DecimalInput | null, status: DividendStatus) {
  if (amountPerShare == null || status === "unavailable") return null;
  return decimal(quantity).mul(decimal(amountPerShare));
}

export function dedupeNews<T extends { url: string; title: string; sourceName: string }>(items: T[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = item.url.trim().toLowerCase() || `${item.sourceName}:${item.title}`.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
