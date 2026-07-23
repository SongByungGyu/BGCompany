import "server-only";
import { createHash } from "node:crypto";
import { portfolioConfig } from "./portfolio-config";
import { kisReadOnlyGet } from "./portfolio-price-provider";
import {
  normalizeKisDomesticHoldings,
  normalizeKisOverseasHoldings,
  type KisSyncedHolding,
} from "./kis-account-normalizer";
import type { PortfolioMarket } from "./portfolio-types";

const KIS_REAL_HOST = "openapi.koreainvestment.com";
const MAX_PAGES = 10;

type KisAccountConfig = {
  accountNumber: string;
  productCode: string;
  accountLabel: string;
  externalAccountRef: string;
  maskedAccount: string;
  markets: PortfolioMarket[];
};

function stringValue(row: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return "";
}

export function getKisAccountConfig(): KisAccountConfig {
  if (!portfolioConfig().accountSyncEnabled) throw new Error("KIS_ACCOUNT_SYNC_DISABLED");
  if (portfolioConfig().priceProvider !== "kis") throw new Error("KIS_ACCOUNT_SYNC_REQUIRES_KIS_PRICE_PROVIDER");
  const base = new URL(process.env.KIS_BASE_URL?.trim() || "https://openapi.koreainvestment.com:9443");
  if (base.protocol !== "https:" || base.hostname !== KIS_REAL_HOST) throw new Error("KIS_REAL_ACCOUNT_HOST_REQUIRED");
  const accountNumber = process.env.KIS_ACCOUNT_NUMBER?.trim() ?? "";
  const productCode = process.env.KIS_ACCOUNT_PRODUCT_CODE?.trim() ?? "";
  if (!/^\d{8}$/.test(accountNumber)) throw new Error("KIS_ACCOUNT_NUMBER_MISSING");
  if (!/^\d{2}$/.test(productCode)) throw new Error("KIS_ACCOUNT_PRODUCT_CODE_MISSING");
  const digest = createHash("sha256").update(`${accountNumber}-${productCode}`).digest("hex").slice(0, 20);
  const configuredMarkets = (process.env.KIS_ACCOUNT_MARKETS ?? "KR,US").split(",").map((value) => value.trim().toUpperCase());
  const markets = (["KR", "US"] as const).filter((market) => configuredMarkets.includes(market));
  if (!markets.length) throw new Error("KIS_ACCOUNT_MARKETS_INVALID");
  return {
    accountNumber,
    productCode,
    accountLabel: process.env.KIS_ACCOUNT_LABEL?.trim().slice(0, 100) || "한국투자증권 실계좌",
    externalAccountRef: `kis:${digest}`,
    maskedAccount: `${accountNumber.slice(0, 2)}••••${accountNumber.slice(-2)}-${productCode}`,
    markets,
  };
}

export function getKisAccountSyncPublicConfig() {
  if (!portfolioConfig().accountSyncEnabled) {
    return { enabled: false, configured: false, maskedAccount: null };
  }
  try {
    const config = getKisAccountConfig();
    return { enabled: true, configured: true, maskedAccount: config.maskedAccount };
  } catch {
    return { enabled: true, configured: false, maskedAccount: null };
  }
}

async function domesticHoldings(config: KisAccountConfig) {
  const found: KisSyncedHolding[] = [];
  let fk100 = "";
  let nk100 = "";
  let trCont = "";
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const response = await kisReadOnlyGet(
      "/uapi/domestic-stock/v1/trading/inquire-balance",
      "TTTC8434R",
      {
        CANO: config.accountNumber,
        ACNT_PRDT_CD: config.productCode,
        AFHR_FLPR_YN: "N",
        OFL_YN: "",
        INQR_DVSN: "02",
        UNPR_DVSN: "01",
        FUND_STTL_ICLD_YN: "N",
        FNCG_AMT_AUTO_RDPT_YN: "N",
        PRCS_DVSN: "00",
        CTX_AREA_FK100: fk100,
        CTX_AREA_NK100: nk100,
      },
      trCont,
    );
    found.push(...normalizeKisDomesticHoldings(response.body.output1));
    const hasNext = response.trCont === "M" || response.trCont === "F";
    if (!hasNext) break;
    fk100 = stringValue(response.body, "ctx_area_fk100");
    nk100 = stringValue(response.body, "ctx_area_nk100");
    if (!fk100 && !nk100) break;
    trCont = "N";
  }
  return found;
}

async function overseasHoldings(config: KisAccountConfig) {
  const found: KisSyncedHolding[] = [];
  let fk200 = "";
  let nk200 = "";
  let trCont = "";
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const response = await kisReadOnlyGet(
      "/uapi/overseas-stock/v1/trading/inquire-balance",
      "TTTS3012R",
      {
        CANO: config.accountNumber,
        ACNT_PRDT_CD: config.productCode,
        OVRS_EXCG_CD: "NASD",
        TR_CRCY_CD: "USD",
        CTX_AREA_FK200: fk200,
        CTX_AREA_NK200: nk200,
      },
      trCont,
    );
    found.push(...normalizeKisOverseasHoldings(response.body.output1));
    const hasNext = response.trCont === "M" || response.trCont === "F";
    if (!hasNext) break;
    fk200 = stringValue(response.body, "ctx_area_fk200");
    nk200 = stringValue(response.body, "ctx_area_nk200");
    if (!fk200 && !nk200) break;
    trCont = "N";
  }
  return found;
}

export async function fetchKisAccountHoldings() {
  const config = getKisAccountConfig();
  const [domestic, overseas] = await Promise.all([
    config.markets.includes("KR") ? domesticHoldings(config) : Promise.resolve([]),
    config.markets.includes("US") ? overseasHoldings(config) : Promise.resolve([]),
  ]);
  const unique = new Map<string, KisSyncedHolding>();
  for (const holding of [...domestic, ...overseas]) unique.set(`${holding.market}:${holding.symbol}`, holding);
  return {
    config,
    holdings: Array.from(unique.values()),
    domesticCount: domestic.length,
    overseasCount: overseas.length,
  };
}

export const KIS_ACCOUNT_READ_ONLY_POLICY = {
  methods: ["GET"],
  endpoints: [
    "/uapi/domestic-stock/v1/trading/inquire-balance",
    "/uapi/overseas-stock/v1/trading/inquire-balance",
  ],
  trIds: ["TTTC8434R", "TTTS3012R"],
  prohibitedPathFragments: ["order", "rvsecncl", "buy", "sell", "transfer"],
  storesFullAccountNumber: false,
} as const;
