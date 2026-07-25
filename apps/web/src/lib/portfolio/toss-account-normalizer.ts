import type { PortfolioAssetType, PortfolioCurrency, PortfolioMarket } from "./portfolio-types";
import { getPortfolioHoldingProfile } from "./portfolio-holding-profiles.ts";

export type TossSyncedHolding = {
  market: PortfolioMarket;
  symbol: string;
  name: string;
  assetType: PortfolioAssetType;
  quantity: string;
  averagePrice: string;
  currency: PortfolioCurrency;
  sector: string;
  currentPrice: string | null;
  analysis: string | null;
  dividendTrackingEnabled: boolean;
};

function record(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function stringValue(row: Record<string, unknown>, key: string) {
  const value = row[key];
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function decimalValue(row: Record<string, unknown>, key: string) {
  const value = stringValue(row, key).replaceAll(",", "");
  return /^\d+(?:\.\d+)?$/.test(value) ? value : "0";
}

function positiveDecimalValue(row: Record<string, unknown>, key: string) {
  const value = decimalValue(row, key);
  return Number(value) > 0 ? value : null;
}

function assetType(name: string): PortfolioAssetType {
  const upper = name.toUpperCase();
  return upper.includes("ETF") || upper.includes("ETN") ? "ETF" : "stock";
}

export function normalizeTossHoldings(value: unknown): TossSyncedHolding[] {
  const container = record(value);
  const rawItems = Array.isArray(value)
    ? value
    : Array.isArray(container.items)
      ? container.items
      : [];
  return rawItems.flatMap((item) => {
    const row = record(item);
    const market = stringValue(row, "marketCountry").toUpperCase();
    const currency = stringValue(row, "currency").toUpperCase();
    const symbol = stringValue(row, "symbol").toUpperCase();
    const quantity = decimalValue(row, "quantity");
    if (!symbol || Number(quantity) <= 0) return [];
    if (market !== "KR" && market !== "US") return [];
    if (currency !== "KRW" && currency !== "USD") return [];
    const profile = getPortfolioHoldingProfile(market as PortfolioMarket, symbol);
    const responseName = stringValue(row, "name");
    const name = profile?.name ?? (responseName || symbol);
    return [{
      market: market as PortfolioMarket,
      symbol,
      name,
      assetType: profile?.assetType ?? assetType(name),
      quantity,
      averagePrice: decimalValue(row, "averagePurchasePrice"),
      currency: currency as PortfolioCurrency,
      sector: profile?.sector ?? "미분류",
      currentPrice: positiveDecimalValue(row, "lastPrice"),
      analysis: profile?.analysis ?? null,
      dividendTrackingEnabled: Boolean(profile),
    }];
  });
}
