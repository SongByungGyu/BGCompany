import { asNumber, asRecord, asRecords, directionFromChange, makeSource, metricFromSource, parseDateTime } from "./market-data-utils";
import { getInvestorFlowBusinessDateCandidates, hasMeaningfulInvestorFlowValues } from "../investor-flow-policy";
import {
  getKisMinRequestIntervalMs,
  KIS_MAX_RETRIES,
  KIS_PROHIBITED_CAPABILITIES,
  KIS_RETRYABLE_HTTP_STATUSES,
  KIS_RETRYABLE_RESPONSE_CODES,
} from "./kis-request-policy";
import type { MarketSnapshot, MarketSnapshotSource, ReferenceSearchInput } from "./reference-types";

const KIS_ALLOWED_REQUESTS = new Map<string, string>([
  ["/uapi/domestic-stock/v1/quotations/inquire-index-daily-price", "FHPUP02120000"],
  ["/uapi/domestic-stock/v1/quotations/inquire-investor-daily-by-market", "FHPTJ04040000"],
  ["/uapi/domestic-stock/v1/quotations/inquire-index-category-price", "FHPUP02140000"],
  ["/uapi/overseas-price/v1/quotations/inquire-daily-chartprice", "FHKST03030100"],
] as const);

const KIS_ALLOWED_HOSTS = new Set(["openapi.koreainvestment.com", "openapivts.koreainvestment.com"]);
const KIS_DOC_URL = "https://github.com/koreainvestment/open-trading-api";

type KisStatus = MarketSnapshot["status"];
export type KisDiagnostic = {
  item: string;
  code: string;
  httpStatus?: number;
};

export type KisResult = {
  status: KisStatus;
  korea?: MarketSnapshot["korea"];
  us?: MarketSnapshot["us"];
  sources: MarketSnapshotSource[];
  missingItems: string[];
  diagnostics?: KisDiagnostic[];
};

type KisToken = { value: string; expiresAt: number };
let tokenCache: KisToken | undefined;
let tokenRequest: Promise<KisToken> | undefined;
let requestQueue: Promise<void> = Promise.resolve();
let lastRequestStartedAt = 0;

function requiredCredentials() {
  const appKey = process.env.KIS_APP_KEY?.trim();
  const appSecret = process.env.KIS_APP_SECRET?.trim();
  return appKey && appSecret ? { appKey, appSecret } : undefined;
}

function baseUrl() {
  const configured = process.env.KIS_BASE_URL?.trim() || "https://openapi.koreainvestment.com:9443";
  const url = new URL(configured);
  if (url.protocol !== "https:" || !KIS_ALLOWED_HOSTS.has(url.hostname)) throw new Error("KIS_BASE_URL_NOT_ALLOWED");
  return url.origin;
}

function timeoutMs() {
  const parsed = Number.parseInt(process.env.KIS_TIMEOUT_MS ?? "10000", 10);
  return Number.isFinite(parsed) ? Math.max(1000, Math.min(parsed, 30000)) : 10000;
}

function maxRetries() {
  const parsed = Number.parseInt(process.env.KIS_MAX_RETRIES ?? "2", 10);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(parsed, KIS_MAX_RETRIES)) : KIS_MAX_RETRIES;
}

function retryBaseDelayMs() {
  const parsed = Number.parseInt(process.env.KIS_RETRY_BASE_DELAY_MS ?? "500", 10);
  return Number.isFinite(parsed) ? Math.max(200, Math.min(parsed, 5000)) : 500;
}

function minRequestIntervalMs() {
  return getKisMinRequestIntervalMs(process.env.KIS_MIN_REQUEST_INTERVAL_MS);
}

function retryDelayMs(attempt: number) {
  return Math.min(retryBaseDelayMs() * (2 ** attempt), 10000);
}

function wait(delayMs: number) {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

async function runPacedRequest<T>(request: () => Promise<T>) {
  const run = requestQueue.then(async () => {
    const remainingDelay = lastRequestStartedAt + minRequestIntervalMs() - Date.now();
    if (remainingDelay > 0) await wait(remainingDelay);
    lastRequestStartedAt = Date.now();
    return request();
  });
  requestQueue = run.then(() => undefined, () => undefined);
  return run;
}

export function getKisMarketFreshnessMinutes(
  now = new Date(),
  env?: { KIS_MARKET_MAX_AGE_MINUTES?: string; KIS_WEEKEND_MAX_AGE_MINUTES?: string },
) {
  const parsed = Number.parseInt(env?.KIS_MARKET_MAX_AGE_MINUTES ?? process.env.KIS_MARKET_MAX_AGE_MINUTES ?? "4320", 10);
  const baseMinutes = Number.isFinite(parsed) ? Math.max(60, parsed) : 4320;
  const weekday = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Seoul", weekday: "short" }).format(now);
  // 월요일 미국장 개장 전에는 금요일 종가가 여전히 최신 확정값이다.
  if (weekday !== "Sat" && weekday !== "Sun" && weekday !== "Mon") return baseMinutes;
  const weekendParsed = Number.parseInt(env?.KIS_WEEKEND_MAX_AGE_MINUTES ?? process.env.KIS_WEEKEND_MAX_AGE_MINUTES ?? "5760", 10);
  const weekendMinutes = Number.isFinite(weekendParsed) ? Math.max(baseMinutes, weekendParsed) : 5760;
  return weekendMinutes;
}

async function getAccessToken(credentials: { appKey: string; appSecret: string }) {
  if (tokenCache && tokenCache.expiresAt > Date.now() + 60000) return tokenCache.value;
  if (!tokenRequest) {
    tokenRequest = (async () => {
      const response = await fetch(`${baseUrl()}/oauth2/tokenP`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ grant_type: "client_credentials", appkey: credentials.appKey, appsecret: credentials.appSecret }),
        signal: AbortSignal.timeout(timeoutMs()),
      });
      if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? "KIS_AUTH_FAILED" : `KIS_TOKEN_HTTP_${response.status}`);
      const body = asRecord(await response.json());
      const accessToken = typeof body?.access_token === "string" ? body.access_token : undefined;
      if (!accessToken) throw new Error("KIS_TOKEN_PARSE_FAILED");
      const expiresIn = asNumber(body?.expires_in) ?? 86400;
      return { value: accessToken, expiresAt: Date.now() + Math.max(300, expiresIn) * 1000 };
    })();
  }
  try {
    tokenCache = await tokenRequest;
    return tokenCache.value;
  } finally {
    tokenRequest = undefined;
  }
}

async function kisGet(path: string, trId: string, params: Record<string, string>, credentials: { appKey: string; appSecret: string }, token: string) {
  if (KIS_ALLOWED_REQUESTS.get(path) !== trId) throw new Error("KIS_QUERY_NOT_ALLOWLISTED");
  const url = new URL(path, baseUrl());
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  for (let attempt = 0; attempt <= maxRetries(); attempt += 1) {
    const response = await runPacedRequest(() => fetch(url, {
      headers: {
        authorization: `Bearer ${token}`,
        appkey: credentials.appKey,
        appsecret: credentials.appSecret,
        tr_id: trId,
        custtype: "P",
      },
      signal: AbortSignal.timeout(timeoutMs()),
    }));
    if (!response.ok) {
      if (KIS_RETRYABLE_HTTP_STATUSES.has(response.status) && attempt < maxRetries()) {
        try { await response.body?.cancel(); } catch { /* response body contains no required data */ }
        await wait(retryDelayMs(attempt));
        continue;
      }
      if (response.status === 401 || response.status === 403) throw new Error("KIS_AUTH_FAILED");
      if (response.status === 429) throw new Error("KIS_RATE_LIMITED");
      throw new Error(`KIS_HTTP_${response.status}`);
    }
    const body = asRecord(await response.json());
    if (!body) throw new Error("KIS_PARSE_FAILED");
    if (typeof body.rt_cd === "string" && body.rt_cd !== "0") {
      const messageCode = typeof body.msg_cd === "string" ? body.msg_cd.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 40) : "UNKNOWN";
      if (KIS_RETRYABLE_RESPONSE_CODES.has(messageCode) && attempt < maxRetries()) {
        await wait(retryDelayMs(attempt));
        continue;
      }
      throw new Error(`KIS_RESPONSE_${messageCode}`);
    }
    return body;
  }
  throw new Error("KIS_RATE_LIMITED");
}

function safeDiagnostic(item: string, error: unknown): KisDiagnostic {
  const raw = error instanceof Error ? error.message : "KIS_UNKNOWN_ERROR";
  const code = /^KIS_(?:AUTH_FAILED|RATE_LIMITED|PARSE_FAILED|QUERY_NOT_ALLOWLISTED|BASE_URL_NOT_ALLOWED|TOKEN_PARSE_FAILED|TOKEN_HTTP_\d{3}|HTTP_\d{3}|RESPONSE_[A-Za-z0-9_-]+)$/.test(raw)
    ? raw
    : "KIS_UNKNOWN_ERROR";
  const match = code.match(/(?:TOKEN_)?HTTP_(\d{3})$/);
  return { item, code, ...(match ? { httpStatus: Number(match[1]) } : {}) };
}

function seoulDate(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(date).replace(/-/g, "");
}

function source(label: string, asOf: string, collectedAt: string, endpoint: string): MarketSnapshotSource {
  return makeSource({
    provider: "kis",
    sourceName: `한국투자증권 Open API · ${label}`,
    url: `${baseUrl()}${endpoint}`,
    asOf,
    collectedAt,
    maxAgeMinutes: getKisMarketFreshnessMinutes(new Date(collectedAt)),
  });
}

function indexMetric(label: string, output: unknown, collectedAt: string, endpoint: string) {
  const row = asRecords(output)[0];
  if (!row) return undefined;
  const value = asNumber(row.bstp_nmix_prpr);
  const changePct = asNumber(row.bstp_nmix_prdy_ctrt);
  if (value === undefined) return undefined;
  const rawDate = typeof row.stck_bsop_date === "string" ? row.stck_bsop_date : undefined;
  const asOf = parseDateTime(rawDate) ?? collectedAt;
  const dataSource = source(label, asOf, collectedAt, endpoint);
  return { metric: metricFromSource({ label, value, changePct, direction: directionFromChange(changePct), source: dataSource }), source: dataSource };
}

function investorMetrics(output: unknown, market: string, collectedAt: string, endpoint: string) {
  for (const row of asRecords(output)) {
    const values = [
      asNumber(row.frgn_ntby_tr_pbmn),
      asNumber(row.orgn_ntby_tr_pbmn),
      asNumber(row.prsn_ntby_tr_pbmn),
    ];
    if (values.some((value) => value === undefined)) continue;
    const verifiedValues = values as number[];
    if (!hasMeaningfulInvestorFlowValues(verifiedValues)) continue;
    const asOf = parseDateTime(typeof row.stck_bsop_date === "string" ? row.stck_bsop_date : undefined) ?? collectedAt;
    const dataSource = source(`${market} 투자자별 매매동향`, asOf, collectedAt, endpoint);
    const names = ["외국인", "기관", "개인"];
    const metrics = names.map((name, index) => metricFromSource({
      label: `${market} ${name} 순매수`,
      value: verifiedValues[index],
      unit: "백만원",
      direction: directionFromChange(verifiedValues[index]),
      source: dataSource,
    }));
    return { metrics, source: dataSource };
  }
  return undefined;
}

function sectorNames(output: unknown) {
  const rows = asRecords(output)
    .map((row) => ({ name: typeof row.hts_kor_isnm === "string" ? row.hts_kor_isnm.trim() : "", change: asNumber(row.bstp_nmix_prdy_ctrt) }))
    .filter((row): row is { name: string; change: number } => Boolean(row.name) && row.change !== undefined)
    .sort((left, right) => right.change - left.change);
  return {
    strong: rows.filter((row) => row.change > 0).slice(0, 5).map((row) => `${row.name} ${row.change.toFixed(2)}%`),
    weak: [...rows].reverse().filter((row) => row.change < 0).slice(0, 5).map((row) => `${row.name} ${row.change.toFixed(2)}%`),
  };
}

function overseasMetric(label: string, body: Record<string, unknown>, collectedAt: string, endpoint: string) {
  const summary = asRecords(body.output1)[0];
  const rows = asRecords(body.output2);
  const latest = rows[0] ?? summary;
  if (!latest) return undefined;
  const value = asNumber(latest.ovrs_nmix_prpr);
  if (value === undefined) return undefined;
  const previous = asNumber(rows[1]?.ovrs_nmix_prpr);
  const changePct = asNumber(summary?.prdy_ctrt) ?? (previous ? ((value - previous) / previous) * 100 : undefined);
  const rawDate = typeof latest.stck_bsop_date === "string" ? latest.stck_bsop_date : undefined;
  const asOf = parseDateTime(rawDate) ?? collectedAt;
  const dataSource = source(label, asOf, collectedAt, endpoint);
  return { metric: metricFromSource({ label, value, changePct, direction: directionFromChange(changePct), source: dataSource }), source: dataSource };
}

export async function collectKisMarketData(input: ReferenceSearchInput): Promise<KisResult> {
  const credentials = requiredCredentials();
  if (!credentials) return { status: "needs_credentials", sources: [], missingItems: ["KIS_APP_KEY", "KIS_APP_SECRET"] };
  const collectedAt = new Date().toISOString();
  const sources: MarketSnapshotSource[] = [];
  const missingItems: string[] = [];
  const diagnostics: KisDiagnostic[] = [];
  const korea: NonNullable<MarketSnapshot["korea"]> = { investorFlows: [], strongSectors: [], weakSectors: [] };
  const us: NonNullable<MarketSnapshot["us"]> = {};
  try {
    const token = await getAccessToken(credentials);
    const indexPath = "/uapi/domestic-stock/v1/quotations/inquire-index-daily-price";
    for (const [key, code, label] of [["kospi", "0001", "KOSPI"], ["kosdaq", "1001", "KOSDAQ"]] as const) {
      try {
        const body = await kisGet(indexPath, "FHPUP02120000", {
          FID_PERIOD_DIV_CODE: "D", FID_COND_MRKT_DIV_CODE: "U", FID_INPUT_ISCD: code, FID_INPUT_DATE_1: seoulDate(),
        }, credentials, token);
        const result = indexMetric(label, body.output2, collectedAt, indexPath);
        if (result) { korea[key] = result.metric; sources.push(result.source); } else missingItems.push(label);
      } catch (error) { missingItems.push(label); diagnostics.push(safeDiagnostic(label, error)); }
    }

    const investorPath = "/uapi/domestic-stock/v1/quotations/inquire-investor-daily-by-market";
    const businessDates = getInvestorFlowBusinessDateCandidates(input.contentType, new Date(collectedAt));
    for (const [code, marketCode, label] of [["0001", "KSP", "KOSPI"], ["1001", "KSQ", "KOSDAQ"]] as const) {
      try {
        let result: ReturnType<typeof investorMetrics>;
        for (const businessDate of businessDates) {
          const body = await kisGet(investorPath, "FHPTJ04040000", {
            FID_COND_MRKT_DIV_CODE: "U", FID_INPUT_ISCD: code, FID_INPUT_DATE_1: businessDate,
            FID_INPUT_ISCD_1: marketCode, FID_INPUT_DATE_2: businessDate, FID_INPUT_ISCD_2: code,
          }, credentials, token);
          result = investorMetrics(body.output, label, collectedAt, investorPath);
          if (result) break;
        }
        if (result) {
          korea.investorFlows?.push(...result.metrics);
          sources.push(result.source);
        } else {
          const item = `${label} 투자자 수급`;
          missingItems.push(item);
          diagnostics.push({ item, code: "KIS_EMPTY_METRIC" });
        }
      } catch (error) { const item = `${label} 투자자 수급`; missingItems.push(item); diagnostics.push(safeDiagnostic(item, error)); }
    }

    const sectorPath = "/uapi/domestic-stock/v1/quotations/inquire-index-category-price";
    for (const [code, marketCode, label] of [["0001", "K", "KOSPI"], ["1001", "Q", "KOSDAQ"]] as const) {
      try {
        const body = await kisGet(sectorPath, "FHPUP02140000", {
          FID_COND_MRKT_DIV_CODE: "U", FID_INPUT_ISCD: code, FID_COND_SCR_DIV_CODE: "20214",
          FID_MRKT_CLS_CODE: marketCode, FID_BLNG_CLS_CODE: "0",
        }, credentials, token);
        const sectors = sectorNames(body.output2);
        korea.strongSectors?.push(...sectors.strong);
        korea.weakSectors?.push(...sectors.weak);
        const dataSource = source(`${label} 업종 흐름`, collectedAt, collectedAt, sectorPath);
        sources.push(dataSource);
        if (!sectors.strong.length || !sectors.weak.length) missingItems.push(`${label} 강세/약세 업종`);
      } catch (error) { const item = `${label} 강세/약세 업종`; missingItems.push(item); diagnostics.push(safeDiagnostic(item, error)); }
    }

    const overseasPath = "/uapi/overseas-price/v1/quotations/inquire-daily-chartprice";
    const endDate = seoulDate();
    const startDate = seoulDate(new Date(Date.now() - 14 * 86400000));
    const overseasDefinitions = [
      ["sp500", "N", process.env.KIS_SP500_CODE?.trim() || "SPX", "S&P 500"],
      ["nasdaq", "N", process.env.KIS_NASDAQ_CODE?.trim() || "COMP", "NASDAQ"],
      ["dow", "N", process.env.KIS_DOW_CODE?.trim() || ".DJI", "Dow Jones"],
      ["fx", "X", process.env.KIS_USD_KRW_CODE?.trim() || "FX@KRW", "USD/KRW"],
    ] as const;
    for (const [key, division, code, label] of overseasDefinitions) {
      try {
        const body = await kisGet(overseasPath, "FHKST03030100", {
          FID_COND_MRKT_DIV_CODE: division, FID_INPUT_ISCD: code, FID_INPUT_DATE_1: startDate,
          FID_INPUT_DATE_2: endDate, FID_PERIOD_DIV_CODE: "D",
        }, credentials, token);
        const result = overseasMetric(label, body, collectedAt, overseasPath);
        if (result) { us[key] = result.metric; sources.push(result.source); }
        else { missingItems.push(label); diagnostics.push({ item: label, code: "KIS_EMPTY_METRIC" }); }
      } catch (error) { missingItems.push(label); diagnostics.push(safeDiagnostic(label, error)); }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "KIS_ERROR";
    return {
      status: message === "KIS_AUTH_FAILED" ? "needs_credentials" : "error",
      sources,
      diagnostics: [...diagnostics, safeDiagnostic("KIS provider", error)],
      missingItems: message === "KIS_AUTH_FAILED" ? ["유효한 KIS 조회 API 자격증명"] : ["한국투자증권 조회 API 응답"],
    };
  }

  if (!korea.investorFlows?.length) missingItems.push("투자자별 매매동향");
  if (!korea.strongSectors?.length || !korea.weakSectors?.length) missingItems.push("국내 업종 흐름");
  return {
    status: missingItems.length ? "needs_data" : "ready",
    korea,
    us,
    sources,
    diagnostics,
    missingItems: Array.from(new Set(missingItems)),
  };
}

export const KIS_READ_ONLY_POLICY = {
  tokenPath: "/oauth2/tokenP",
  allowedRequests: Array.from(KIS_ALLOWED_REQUESTS.entries()).map(([path, trId]) => ({ path, trId })),
  retryableHttpStatuses: Array.from(KIS_RETRYABLE_HTTP_STATUSES),
  retryableResponseCodes: Array.from(KIS_RETRYABLE_RESPONSE_CODES),
  minimumRequestIntervalMs: getKisMinRequestIntervalMs(),
  maximumRetries: KIS_MAX_RETRIES,
  prohibitedCapabilities: KIS_PROHIBITED_CAPABILITIES,
  documentation: KIS_DOC_URL,
} as const;
