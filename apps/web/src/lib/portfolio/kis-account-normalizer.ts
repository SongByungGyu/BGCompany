import type { PortfolioAssetType, PortfolioCurrency, PortfolioMarket } from "./portfolio-types";

export type KisSyncedHolding = {
  market: PortfolioMarket;
  symbol: string;
  name: string;
  assetType: PortfolioAssetType;
  quantity: string;
  averagePrice: string;
  currency: PortfolioCurrency;
  sector: string;
  currentPrice: string | null;
};

function record(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function rows(value: unknown) {
  return Array.isArray(value) ? value.map(record) : value ? [record(value)] : [];
}

function stringValue(row: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return "";
}

function decimalValue(row: Record<string, unknown>, ...keys: string[]) {
  const value = stringValue(row, ...keys).replaceAll(",", "");
  return /^\d+(?:\.\d+)?$/.test(value) ? value : "0";
}

function positiveDecimalValue(row: Record<string, unknown>, ...keys: string[]) {
  const value = decimalValue(row, ...keys);
  return Number(value) > 0 ? value : null;
}

function assetType(name: string): PortfolioAssetType {
  const upper = name.toUpperCase();
  return upper.includes("ETF") || upper.includes("ETN") ? "ETF" : "stock";
}

export function normalizeKisDomesticHoldings(value: unknown): KisSyncedHolding[] {
  return rows(value).flatMap((row) => {
    const quantity = decimalValue(row, "hldg_qty");
    const symbol = stringValue(row, "pdno").toUpperCase();
    if (Number(quantity) <= 0 || !symbol) return [];
    const name = stringValue(row, "prdt_name") || symbol;
    return [{
      market: "KR" as const,
      symbol,
      name,
      assetType: assetType(name),
      quantity,
      averagePrice: decimalValue(row, "pchs_avg_pric"),
      currency: "KRW" as const,
      sector: "미분류",
      currentPrice: positiveDecimalValue(row, "prpr"),
    }];
  });
}

export function normalizeKisOverseasHoldings(value: unknown): KisSyncedHolding[] {
  return rows(value).flatMap((row) => {
    const quantity = decimalValue(row, "ovrs_cblc_qty");
    const symbol = stringValue(row, "ovrs_pdno").toUpperCase();
    if (Number(quantity) <= 0 || !symbol) return [];
    const name = stringValue(row, "ovrs_item_name") || symbol;
    return [{
      market: "US" as const,
      symbol,
      name,
      assetType: assetType(name),
      quantity,
      averagePrice: decimalValue(row, "pchs_avg_pric", "avg_unpr3"),
      currency: "USD" as const,
      sector: "미분류",
      currentPrice: positiveDecimalValue(row, "now_pric2"),
    }];
  });
}
