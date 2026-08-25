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
  ["/uapi/domestic-stock/v1/quotations/chk-holiday", "CTCA0903R"],
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
  recovered?: boolean;
};

export type KisResult = {
  status: KisStatus;
  korea?: MarketSnapshot["korea"];
  us?: MarketSnapshot["us"];
  sources: MarketSnapshotSource[];
  missingItems: string[];
  diagnostics?: KisDiagnostic[];
};

export type KisKoreaMarketSession = {
  marketDate: string;
  isOpen: boolean;
  isBusinessDay: boolean;
  isTradingDay: boolean;
  isSettlementDay: boolean;
};

export type KisKoreaMarketCalendarResult = {
  status: "ready" | "needs_credentials" | "error";
  sessions: KisKoreaMarketSession[];
  reason?: string;
};

type KisToken = { value: string; expiresAt: number };
let tokenCache: KisToken | undefined;
let tokenRequest: Promise<KisToken> | undefined;
let requestQueue: Promise<void> = Promise.resolve();
let lastRequestStartedAt = 0;
const koreaMarketSessionCache = new Map<string, boolean>();
const overseasMetricCache = new Map<string, { metric: NonNullable<MarketSnapshot["us"]>["sp500"]; source: MarketSnapshotSource }>();

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

function overseasGroupMaxRetries() {
  const parsed = Number.parseInt(process.env.KIS_OVERSEAS_GROUP_MAX_RETRIES ?? "2", 10);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(parsed, 2)) : 2;
}

function overseasGroupRetryDelayMs(attempt: number) {
  const parsed = Number.parseInt(process.env.KIS_OVERSEAS_GROUP_RETRY_DELAY_MS ?? "1500", 10);
  const base = Number.isFinite(parsed) ? Math.max(500, Math.min(parsed, 10000)) : 1500;
  return Math.min(base * (attempt + 1), 15000);
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
  env?: {
    KIS_MARKET_MAX_AGE_MINUTES?: string;
    KIS_WEEKEND_MAX_AGE_MINUTES?: string;
    KIS_HOLIDAY_MAX_AGE_MINUTES?: string;
    STOCK_BLOG_KRX_CLOSED_DATES?: string;
  },
) {
  const parsed = Number.parseInt(env?.KIS_MARKET_MAX_AGE_MINUTES ?? process.env.KIS_MARKET_MAX_AGE_MINUTES ?? "4320", 10);
  const baseMinutes = Number.isFinite(parsed) ? Math.max(60, parsed) : 4320;
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  const yesterday = new Date(`${today}T00:00:00Z`);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const todayCompact = today.replace(/-/g, "");
  const yesterdayCompact = yesterday.toISOString().slice(0, 10).replace(/-/g, "");
  const configuredClosedDates = new Set(
    (env?.STOCK_BLOG_KRX_CLOSED_DATES ?? process.env.STOCK_BLOG_KRX_CLOSED_DATES ?? "")
      .split(",")
      .map((value) => value.trim().replace(/-/g, ""))
      .filter((value) => /^\d{8}$/.test(value)),
  );
  const recentMarketHoliday = koreaMarketSessionCache.get(todayCompact) === false
    || koreaMarketSessionCache.get(yesterdayCompact) === false
    || configuredClosedDates.has(todayCompact)
    || configuredClosedDates.has(yesterdayCompact);
  if (recentMarketHoliday) {
    const holidayParsed = Number.parseInt(env?.KIS_HOLIDAY_MAX_AGE_MINUTES ?? process.env.KIS_HOLIDAY_MAX_AGE_MINUTES ?? "10080", 10);
    return Number.isFinite(holidayParsed) ? Math.max(baseMinutes, holidayParsed) : 10080;
  }
  const weekday = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Seoul", weekday: "short" }).format(now);
  // 월요일 미국장 개장 전에는 금요일 종가가 여전히 최신 확정값이다.
  if (weekday !== "Sat" && weekday !== "Sun" && weekday !== "Mon") return baseMinutes;
  const weekendParsed = Number.parseInt(env?.KIS_WEEKEND_MAX_AGE_MINUTES ?? process.env.KIS_WEEKEND_MAX_AGE_MINUTES ?? "5760", 10);
  const weekendMinutes = Number.isFinite(weekendParsed) ? Math.max(baseMinutes, weekendParsed) : 5760;
  return weekendMinutes;
}

export function rememberKisKoreaMarketSession(marketDate: string, isOpen: boolean) {
  if (/^\d{8}$/.test(marketDate)) koreaMarketSessionCache.set(marketDate, isOpen);
}

export function resetKisKoreaMarketSessionCacheForTests() {
  koreaMarketSessionCache.clear();
}

export function resetKisOverseasMetricCacheForTests() {
  overseasMetricCache.clear();
}

export function parseKisKoreaMarketCalendar(output: unknown) {
  return asRecords(output)
    .map((row): KisKoreaMarketSession | null => {
      const marketDate = typeof row.bass_dt === "string" ? row.bass_dt : "";
      const isOpen = row.opnd_yn === "Y" ? true : row.opnd_yn === "N" ? false : null;
      if (!/^\d{8}$/.test(marketDate) || isOpen === null) return null;
      return {
        marketDate,
        isOpen,
        isBusinessDay: row.bzdy_yn === "Y",
        isTradingDay: row.tr_day_yn === "Y",
        isSettlementDay: row.sttl_day_yn === "Y",
      };
    })
    .filter((session): session is KisKoreaMarketSession => session !== null);
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

export async function getKisKoreaMarketCalendar(marketDate: string): Promise<KisKoreaMarketCalendarResult> {
  if (!/^\d{8}$/.test(marketDate)) {
    return { status: "error", sessions: [], reason: "KIS_MARKET_CALENDAR_DATE_INVALID" };
  }
  const credentials = requiredCredentials();
  if (!credentials) {
    return { status: "needs_credentials", sessions: [], reason: "KIS_MARKET_CALENDAR_CREDENTIALS_MISSING" };
  }
  try {
    const token = await getAccessToken(credentials);
    const path = "/uapi/domestic-stock/v1/quotations/chk-holiday";
    const body = await kisGet(path, "CTCA0903R", {
      BASS_DT: marketDate,
      CTX_AREA_FK: "",
      CTX_AREA_NK: "",
    }, credentials, token);
    const sessions = parseKisKoreaMarketCalendar(body.output);
    for (const session of sessions) rememberKisKoreaMarketSession(session.marketDate, session.isOpen);
    if (!sessions.some((session) => session.marketDate === marketDate)) {
      return { status: "error", sessions, reason: "KIS_MARKET_CALENDAR_DATE_MISSING" };
    }
    return { status: "ready", sessions };
  } catch (error) {
    const diagnostic = safeDiagnostic("KIS market calendar", error);
    return {
      status: diagnostic.code === "KIS_AUTH_FAILED" ? "needs_credentials" : "error",
      sessions: [],
      reason: diagnostic.code,
    };
  }
}

function safeDiagnostic(item: string, error: unknown): KisDiagnostic {
  const raw = error instanceof Error ? error.message : "KIS_UNKNOWN_ERROR";
  const errorName = error instanceof Error ? error.name : "";
  const code = /^KIS_(?:AUTH_FAILED|RATE_LIMITED|PARSE_FAILED|QUERY_NOT_ALLOWLISTED|BASE_URL_NOT_ALLOWED|TOKEN_PARSE_FAILED|TOKEN_HTTP_\d{3}|HTTP_\d{3}|RESPONSE_[A-Za-z0-9_-]+)$/.test(raw)
    ? raw
    : errorName === "TimeoutError" || errorName === "AbortError"
      ? "KIS_TIMEOUT"
      : error instanceof TypeError
        ? "KIS_NETWORK_FAILED"
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

function configuredKoreaMarketClosedDates() {
  return new Set(
    (process.env.STOCK_BLOG_KRX_CLOSED_DATES ?? "")
      .split(",")
      .map((value) => value.trim().replace(/-/g, ""))
      .filter((value) => /^\d{8}$/.test(value)),
  );
}

function isKnownClosedKoreaMarketDate(marketDate: string) {
  if (!/^\d{8}$/.test(marketDate)) return true;
  if (koreaMarketSessionCache.get(marketDate) === false || configuredKoreaMarketClosedDates().has(marketDate)) return true;
  const date = new Date(Date.UTC(
    Number.parseInt(marketDate.slice(0, 4), 10),
    Number.parseInt(marketDate.slice(4, 6), 10) - 1,
    Number.parseInt(marketDate.slice(6, 8), 10),
  ));
  const weekday = date.getUTCDay();
  return weekday === 0 || weekday === 6;
}

export function selectKisCompletedDomesticIndexRow(output: unknown, beforeMarketDate: string) {
  if (!/^\d{8}$/.test(beforeMarketDate)) return undefined;
  return asRecords(output)
    .filter((row) => {
      const rowDate = typeof row.stck_bsop_date === "string" ? row.stck_bsop_date : "";
      return /^\d{8}$/.test(rowDate)
        && rowDate < beforeMarketDate
        && !isKnownClosedKoreaMarketDate(rowDate)
        && asNumber(row.bstp_nmix_prpr) !== undefined
        && asNumber(row.bstp_nmix_prdy_ctrt) !== undefined;
    })
    .sort((left, right) => String(right.stck_bsop_date).localeCompare(String(left.stck_bsop_date)))[0];
}

function indexMetric(label: string, output: unknown, collectedAt: string, endpoint: string, completedBeforeDate?: string) {
  const row = completedBeforeDate
    ? selectKisCompletedDomesticIndexRow(output, completedBeforeDate)
    : asRecords(output)[0];
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

function cachedOverseasMetric(key: string, collectedAt: string) {
  const cached = overseasMetricCache.get(key);
  if (!cached?.metric?.asOf) return undefined;
  const source = makeSource({
    provider: cached.source.provider,
    sourceName: cached.source.sourceName,
    url: cached.source.url,
    asOf: cached.source.asOf,
    collectedAt,
    maxAgeMinutes: cached.source.maxAgeMinutes,
  }, new Date(collectedAt));
  if (source.freshness !== "fresh") return undefined;
  return {
    metric: metricFromSource({
      label: cached.metric.label,
      value: cached.metric.value,
      unit: cached.metric.unit,
      changePct: cached.metric.changePct,
      direction: cached.metric.direction,
      asOf: cached.metric.asOf,
      source,
    }),
    source,
  };
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
    const completedDomesticSessionBefore = input.contentType === "KOREA_DAILY_PREVIEW"
      ? seoulDate(new Date(collectedAt))
      : undefined;
    for (const [key, code, label] of [["kospi", "0001", "KOSPI"], ["kosdaq", "1001", "KOSDAQ"]] as const) {
      try {
        const body = await kisGet(indexPath, "FHPUP02120000", {
          FID_PERIOD_DIV_CODE: "D", FID_COND_MRKT_DIV_CODE: "U", FID_INPUT_ISCD: code, FID_INPUT_DATE_1: seoulDate(),
        }, credentials, token);
        const result = indexMetric(label, body.output2, collectedAt, indexPath, completedDomesticSessionBefore);
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
    const pending = new Map(overseasDefinitions.map((definition) => [definition[0], definition]));
    const lastDiagnostics = new Map<string, KisDiagnostic>();
    for (let groupAttempt = 0; groupAttempt <= overseasGroupMaxRetries() && pending.size > 0; groupAttempt += 1) {
      for (const [key, division, code, label] of [...pending.values()]) {
        try {
          const body = await kisGet(overseasPath, "FHKST03030100", {
            FID_COND_MRKT_DIV_CODE: division, FID_INPUT_ISCD: code, FID_INPUT_DATE_1: startDate,
            FID_INPUT_DATE_2: endDate, FID_PERIOD_DIV_CODE: "D",
          }, credentials, token);
          const result = overseasMetric(label, body, collectedAt, overseasPath);
          if (result) {
            us[key] = result.metric;
            sources.push(result.source);
            overseasMetricCache.set(key, result);
            pending.delete(key);
            lastDiagnostics.delete(key);
          } else {
            lastDiagnostics.set(key, { item: label, code: "KIS_EMPTY_METRIC" });
          }
        } catch (error) {
          lastDiagnostics.set(key, safeDiagnostic(label, error));
        }
      }
      if (pending.size > 0 && groupAttempt < overseasGroupMaxRetries()) {
        await wait(overseasGroupRetryDelayMs(groupAttempt));
      }
    }
    for (const [key, , , label] of pending.values()) {
      const cached = cachedOverseasMetric(key, collectedAt);
      if (cached) {
        us[key] = cached.metric;
        sources.push(cached.source);
        diagnostics.push({ item: label, code: "KIS_LAST_VERIFIED_FALLBACK_USED", recovered: true });
      } else {
        missingItems.push(label);
        diagnostics.push(lastDiagnostics.get(key) ?? { item: label, code: "KIS_UNKNOWN_ERROR" });
      }
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
  overseasGroupMaximumRetries: 2,
  prohibitedCapabilities: KIS_PROHIBITED_CAPABILITIES,
  documentation: KIS_DOC_URL,
} as const;
