import "server-only";
import type { FreshnessStatus, PortfolioCurrency, PortfolioMarket, PortfolioPriceDto } from "./portfolio-types";
import { portfolioConfig } from "./portfolio-config";
import {
  KIS_PROHIBITED_CAPABILITIES,
  KIS_READ_ONLY_ENDPOINTS,
  isKisReadOnlyRequestAllowed,
} from "./kis-readonly-policy";

type PriceRequest = {
  market: PortfolioMarket;
  symbol: string;
  assetType: string;
  currency: PortfolioCurrency;
};

type PriceProvider = {
  name: "mock" | "kis";
  getPrices(requests: PriceRequest[]): Promise<PortfolioPriceDto[]>;
  getUsdKrw(): Promise<PortfolioPriceDto | null>;
};

const KIS_ALLOWED_HOSTS = new Set(["openapi.koreainvestment.com", "openapivts.koreainvestment.com"]);
const KIS_SOURCE_URL = "https://github.com/koreainvestment/open-trading-api";
type TokenCache = { token: string; expiresAt: number };
let tokenCache: TokenCache | null = null;

function kisBaseUrl() {
  const url = new URL(process.env.KIS_BASE_URL?.trim() || "https://openapi.koreainvestment.com:9443");
  if (url.protocol !== "https:" || !KIS_ALLOWED_HOSTS.has(url.hostname)) throw new Error("KIS_BASE_URL_NOT_ALLOWED");
  return url.origin;
}

function credentials() {
  const appKey = process.env.KIS_APP_KEY?.trim();
  const appSecret = process.env.KIS_APP_SECRET?.trim();
  if (!appKey || !appSecret) throw new Error("KIS_CREDENTIALS_MISSING");
  return { appKey, appSecret };
}

function timeoutMs() {
  const parsed = Number.parseInt(process.env.KIS_TIMEOUT_MS ?? "10000", 10);
  return Number.isFinite(parsed) ? Math.max(1000, Math.min(parsed, 30000)) : 10000;
}

async function accessToken() {
  if (tokenCache && tokenCache.expiresAt > Date.now() + 60_000) return tokenCache.token;
  const { appKey, appSecret } = credentials();
  const response = await fetch(`${kisBaseUrl()}/oauth2/tokenP`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ grant_type: "client_credentials", appkey: appKey, appsecret: appSecret }),
    signal: AbortSignal.timeout(timeoutMs()),
  });
  if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? "KIS_AUTH_FAILED" : `KIS_TOKEN_HTTP_${response.status}`);
  const body = await response.json() as { access_token?: string; expires_in?: number };
  if (!body.access_token) throw new Error("KIS_TOKEN_PARSE_FAILED");
  tokenCache = { token: body.access_token, expiresAt: Date.now() + Math.max(body.expires_in ?? 86400, 300) * 1000 };
  return tokenCache.token;
}

export async function kisReadOnlyGet(path: string, trId: string, params: Record<string, string>, trCont = "") {
  if (!isKisReadOnlyRequestAllowed("GET", path, trId)) throw new Error("KIS_QUERY_NOT_ALLOWLISTED");
  const { appKey, appSecret } = credentials();
  const url = new URL(path, kisBaseUrl());
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  const response = await fetch(url, {
    headers: {
      authorization: `Bearer ${await accessToken()}`,
      appkey: appKey,
      appsecret: appSecret,
      tr_id: trId,
      ...(trCont ? { tr_cont: trCont } : {}),
      custtype: "P",
    },
    signal: AbortSignal.timeout(timeoutMs()),
  });
  if (!response.ok) throw new Error(response.status === 429 ? "KIS_RATE_LIMITED" : `KIS_HTTP_${response.status}`);
  const body = await response.json() as Record<string, unknown>;
  if (body.rt_cd !== "0") throw new Error("KIS_RESPONSE_ERROR");
  return { body, trCont: response.headers.get("tr_cont") ?? "" };
}

async function kisGet(path: string, trId: string, params: Record<string, string>) {
  return (await kisReadOnlyGet(path, trId, params)).body;
}

function record(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function freshness(observedAt: Date): FreshnessStatus {
  const ageMinutes = (Date.now() - observedAt.getTime()) / 60_000;
  if (ageMinutes <= 20) return "fresh";
  if (ageMinutes <= 24 * 60) return "delayed";
  return "stale";
}

function unavailable(request: PriceRequest, sourceName = "한국투자증권 Open API"): PortfolioPriceDto {
  return {
    symbol: request.symbol,
    market: request.market,
    currentPrice: null,
    currency: request.currency,
    change: null,
    changePercent: null,
    weeklyChangePercent: null,
    observedAt: null,
    collectedAt: new Date().toISOString(),
    sourceName,
    sourceUrl: KIS_SOURCE_URL,
    freshnessStatus: "unavailable",
  };
}

function overseasExchangeCodes() {
  const code = process.env.KIS_OVERSEAS_EXCHANGE_CODE?.trim().toUpperCase() || "NAS";
  const preferred = new Set(["NAS", "NYS", "AMS"]).has(code) ? code : "NAS";
  return Array.from(new Set([preferred, "NAS", "NYS", "AMS"]));
}

const kisProvider: PriceProvider = {
  name: "kis",
  async getPrices(requests) {
    const results: PortfolioPriceDto[] = [];
    for (const request of requests) {
      if (request.assetType === "cash") {
        results.push({
          symbol: request.symbol,
          market: request.market,
          currentPrice: "1",
          currency: request.currency,
          change: "0",
          changePercent: "0",
          weeklyChangePercent: "0",
          observedAt: new Date().toISOString(),
          collectedAt: new Date().toISOString(),
          sourceName: "현금 원금",
          sourceUrl: null,
          freshnessStatus: "fresh",
        });
        continue;
      }
      try {
        const collectedAt = new Date().toISOString();
        if (request.market === "KR") {
          const body = await kisGet("/uapi/domestic-stock/v1/quotations/inquire-price", "FHKST01010100", {
            FID_COND_MRKT_DIV_CODE: "J",
            FID_INPUT_ISCD: request.symbol,
          });
          const output = record(body.output);
          const price = stringValue(output.stck_prpr);
          if (!price) {
            results.push(unavailable(request));
            continue;
          }
          const observedAt = new Date();
          results.push({
            symbol: request.symbol,
            market: request.market,
            currentPrice: price,
            currency: "KRW",
            change: stringValue(output.prdy_vrss),
            changePercent: stringValue(output.prdy_ctrt),
            weeklyChangePercent: null,
            observedAt: observedAt.toISOString(),
            collectedAt,
            sourceName: "한국투자증권 Open API · 국내주식 현재가",
            sourceUrl: KIS_SOURCE_URL,
            freshnessStatus: freshness(observedAt),
          });
        } else {
          let output: Record<string, unknown> = {};
          let price: string | null = null;
          for (const exchangeCode of overseasExchangeCodes()) {
            try {
              const body = await kisGet("/uapi/overseas-price/v1/quotations/price", "HHDFS00000300", {
                AUTH: "",
                EXCD: exchangeCode,
                SYMB: request.symbol,
              });
              output = record(body.output);
              price = stringValue(output.last);
              if (price) break;
            } catch {
              continue;
            }
          }
          if (!price) {
            results.push(unavailable(request));
            continue;
          }
          const observedAt = new Date();
          results.push({
            symbol: request.symbol,
            market: request.market,
            currentPrice: price,
            currency: "USD",
            change: stringValue(output.diff),
            changePercent: stringValue(output.rate),
            weeklyChangePercent: null,
            observedAt: observedAt.toISOString(),
            collectedAt,
            sourceName: "한국투자증권 Open API · 해외주식 현재가",
            sourceUrl: KIS_SOURCE_URL,
            freshnessStatus: freshness(observedAt),
          });
        }
      } catch {
        results.push(unavailable(request));
      }
    }
    return results;
  },
  async getUsdKrw() {
    const request: PriceRequest = { market: "US", symbol: "USD/KRW", assetType: "cash", currency: "KRW" };
    try {
      const now = new Date();
      const start = new Date(now.getTime() - 14 * 86400000);
      const date = (value: Date) => value.toISOString().slice(0, 10).replaceAll("-", "");
      const body = await kisGet("/uapi/overseas-price/v1/quotations/inquire-daily-chartprice", "FHKST03030100", {
        FID_COND_MRKT_DIV_CODE: "X",
        FID_INPUT_ISCD: process.env.KIS_USD_KRW_CODE?.trim() || "FX@KRW",
        FID_INPUT_DATE_1: date(start),
        FID_INPUT_DATE_2: date(now),
        FID_PERIOD_DIV_CODE: "D",
      });
      const rows = Array.isArray(body.output2) ? body.output2.map(record) : [];
      const price = stringValue(rows[0]?.ovrs_nmix_prpr);
      if (!price) return unavailable(request, "한국투자증권 Open API · USD/KRW");
      return {
        ...unavailable(request, "한국투자증권 Open API · USD/KRW"),
        currentPrice: price,
        observedAt: now.toISOString(),
        collectedAt: now.toISOString(),
        freshnessStatus: freshness(now),
      };
    } catch {
      return unavailable(request, "한국투자증권 Open API · USD/KRW");
    }
  },
};

function mockNumber(symbol: string) {
  const hash = Array.from(symbol).reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return (50 + (hash % 450) + (hash % 100) / 100).toFixed(2);
}

const mockProvider: PriceProvider = {
  name: "mock",
  async getPrices(requests) {
    if (process.env.NODE_ENV === "production") return requests.map((request) => unavailable(request, "개발용 mock 비활성"));
    const now = new Date().toISOString();
    return requests.map((request) => ({
      symbol: request.symbol,
      market: request.market,
      currentPrice: request.assetType === "cash" ? "1" : mockNumber(request.symbol),
      currency: request.currency,
      change: "0",
      changePercent: "0",
      weeklyChangePercent: "0",
      observedAt: now,
      collectedAt: now,
      sourceName: "개발 UI 검증용 mock",
      sourceUrl: null,
      freshnessStatus: "fresh",
    }));
  },
  async getUsdKrw() {
    if (process.env.NODE_ENV === "production") return null;
    const now = new Date().toISOString();
    return {
      symbol: "USD/KRW",
      market: "US",
      currentPrice: "1350",
      currency: "KRW",
      change: "0",
      changePercent: "0",
      weeklyChangePercent: "0",
      observedAt: now,
      collectedAt: now,
      sourceName: "개발 UI 검증용 mock",
      sourceUrl: null,
      freshnessStatus: "fresh",
    };
  },
};

export function getPortfolioPriceProvider(): PriceProvider {
  return portfolioConfig().priceProvider === "kis" ? kisProvider : mockProvider;
}

export const PORTFOLIO_KIS_READ_ONLY_POLICY = {
  tokenEndpoint: "/oauth2/tokenP",
  allowedGetEndpoints: Object.keys(KIS_READ_ONLY_ENDPOINTS),
  allowedAccountCapabilities: ["domestic_holdings", "overseas_holdings"],
  prohibitedCapabilities: KIS_PROHIBITED_CAPABILITIES,
} as const;
