import type { PortfolioAssetType, PortfolioCurrency, PortfolioMarket } from "./portfolio-types";

function record(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function requiredString(value: unknown, field: string, max = 200) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} 값을 입력하세요.`);
  return value.trim().slice(0, max);
}

function optionalString(value: unknown, max = 1000) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;
}

function oneOf<T extends string>(value: unknown, values: readonly T[], field: string): T {
  if (typeof value !== "string" || !values.includes(value as T)) throw new Error(`${field} 값이 올바르지 않습니다.`);
  return value as T;
}

function decimalString(value: unknown, field: string, allowZero = true) {
  const stringValue = typeof value === "number" ? value.toString() : typeof value === "string" ? value.trim() : "";
  if (!/^\d+(?:\.\d{1,8})?$/.test(stringValue)) throw new Error(`${field}은 0 이상의 숫자여야 합니다.`);
  if (!allowZero && Number(stringValue) <= 0) throw new Error(`${field}은 0보다 커야 합니다.`);
  return stringValue;
}

export function parseAccountInput(value: unknown) {
  const input = record(value);
  if (!input) throw new Error("요청 형식이 올바르지 않습니다.");
  return {
    name: requiredString(input.name, "계좌 별칭", 100),
    baseCurrency: oneOf<PortfolioCurrency>(input.baseCurrency ?? "KRW", ["KRW", "USD"], "기준 통화"),
    description: optionalString(input.description),
  };
}

type HoldingCreateInput = {
  portfolioAccountId: string;
  market: PortfolioMarket;
  symbol: string;
  name: string;
  assetType: PortfolioAssetType;
  quantity: string;
  averagePrice: string;
  currency: PortfolioCurrency;
  sector: string;
  note: string | null;
  dividendTrackingEnabled: boolean;
};

type HoldingUpdateInput = Partial<Pick<HoldingCreateInput, "portfolioAccountId" | "name" | "quantity" | "averagePrice" | "sector" | "note" | "dividendTrackingEnabled">> & {
  isActive?: boolean;
};

export function parseHoldingInput(value: unknown): HoldingCreateInput;
export function parseHoldingInput(value: unknown, partial: true): HoldingUpdateInput;
export function parseHoldingInput(value: unknown, partial = false): HoldingCreateInput | HoldingUpdateInput {
  const input = record(value);
  if (!input) throw new Error("요청 형식이 올바르지 않습니다.");
  if (partial) {
    const result: HoldingUpdateInput = {};
    if ("portfolioAccountId" in input) result.portfolioAccountId = requiredString(input.portfolioAccountId, "계좌", 100);
    if ("name" in input) result.name = requiredString(input.name, "종목명", 120);
    if ("quantity" in input) result.quantity = decimalString(input.quantity, "수량");
    if ("averagePrice" in input) result.averagePrice = decimalString(input.averagePrice, "평균단가");
    if ("sector" in input) result.sector = requiredString(input.sector, "섹터", 80);
    if ("note" in input) result.note = optionalString(input.note);
    if ("dividendTrackingEnabled" in input) result.dividendTrackingEnabled = Boolean(input.dividendTrackingEnabled);
    if ("isActive" in input) result.isActive = Boolean(input.isActive);
    if (!Object.keys(result).length) throw new Error("수정할 항목이 없습니다.");
    return result;
  }
  return {
    portfolioAccountId: requiredString(input.portfolioAccountId, "계좌", 100),
    market: oneOf<PortfolioMarket>(input.market, ["KR", "US"], "시장"),
    symbol: requiredString(input.symbol, "종목 코드", 30).toUpperCase(),
    name: requiredString(input.name, "종목명", 120),
    assetType: oneOf<PortfolioAssetType>(input.assetType, ["stock", "ETF", "fund", "cash"], "자산 유형"),
    quantity: decimalString(input.quantity, "수량"),
    averagePrice: decimalString(input.averagePrice, "평균단가"),
    currency: oneOf<PortfolioCurrency>(input.currency, ["KRW", "USD"], "통화"),
    sector: requiredString(input.sector, "섹터", 80),
    note: optionalString(input.note),
    dividendTrackingEnabled: Boolean(input.dividendTrackingEnabled),
  };
}

export function parseDividendInput(value: unknown) {
  const input = record(value);
  if (!input) throw new Error("요청 형식이 올바르지 않습니다.");
  const optionalDate = (field: string) => {
    const raw = input[field];
    if (!raw) return null;
    const date = new Date(String(raw));
    if (Number.isNaN(date.getTime())) throw new Error(`${field} 날짜가 올바르지 않습니다.`);
    return date;
  };
  return {
    market: oneOf<PortfolioMarket>(input.market, ["KR", "US"], "시장"),
    symbol: requiredString(input.symbol, "종목 코드", 30).toUpperCase(),
    dividendType: requiredString(input.dividendType ?? "annual", "배당 유형", 40),
    amountPerShare: input.amountPerShare == null || input.amountPerShare === "" ? null : decimalString(input.amountPerShare, "주당 배당금"),
    currency: oneOf<PortfolioCurrency>(input.currency, ["KRW", "USD"], "통화"),
    exDividendDate: optionalDate("exDividendDate"),
    recordDate: optionalDate("recordDate"),
    paymentDate: optionalDate("paymentDate"),
    status: oneOf(input.status, ["confirmed", "announced", "estimated", "historical", "unavailable"] as const, "배당 상태"),
    sourceName: optionalString(input.sourceName, 200),
    sourceUrl: optionalString(input.sourceUrl, 1000),
    dataQuality: requiredString(input.dataQuality ?? "manual", "데이터 품질", 40),
  };
}

export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "요청을 처리하지 못했습니다.";
}
