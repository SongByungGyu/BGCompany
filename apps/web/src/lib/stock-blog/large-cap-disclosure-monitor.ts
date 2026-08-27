import type { ReferenceItem } from "./references/reference-types";

export type LargeCapDisclosureEvent = {
  market: "KR" | "US";
  company: string;
  symbol?: string;
  eventType: "earnings" | "material_disclosure";
  title: string;
  filedAt: string;
  sourceUrl: string;
  sourceName: "OpenDART" | "SEC EDGAR";
  summary: string;
};

export type LargeCapDisclosureScanResult = {
  checkedAt: string;
  events: LargeCapDisclosureEvent[];
  providers: {
    openDart: "ready" | "missing_key" | "error";
    secEdgar: "ready" | "error";
  };
  notes: string[];
};

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

function requestTimeoutMs() {
  const parsed = Number(process.env.STOCK_BLOG_OFFICIAL_DISCLOSURE_TIMEOUT_MS ?? "10000");
  return Math.max(3_000, Math.min(Number.isFinite(parsed) ? parsed : 10_000, 30_000));
}

const DEFAULT_KR_LARGE_CAP_NAMES = [
  "삼성전자", "SK하이닉스", "LG에너지솔루션", "삼성바이오로직스", "현대차",
  "기아", "셀트리온", "KB금융", "NAVER", "한화에어로스페이스", "HD현대중공업",
];

const DEFAULT_US_LARGE_CAP_SYMBOLS = [
  "AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "META", "TSLA", "BRK-B",
  "AVGO", "JPM", "LLY", "V", "XOM", "WMT", "MA",
];

const DART_MATERIAL_PATTERN = /잠정.*실적|영업\(잠정\)실적|매출액.*손익구조|분기보고서|반기보고서|사업보고서|주요경영사항|유상증자|무상증자|자기주식|현금.*배당|수주.*계약|합병|분할/i;
const DART_EARNINGS_PATTERN = /실적|매출액.*손익구조|분기보고서|반기보고서|사업보고서/i;
const SEC_EARNINGS_FORMS = new Set(["10-Q", "10-K", "20-F", "40-F", "6-K"]);
const SEC_MATERIAL_8K_ITEMS = new Set(["1.01", "2.01", "2.02", "2.05", "2.06", "7.01", "8.01"]);

function configuredList(value: string | undefined, fallback: string[]) {
  const items = value?.split(",").map((item) => item.trim()).filter(Boolean) ?? [];
  return items.length > 0 ? items : fallback;
}

function kstDate(value: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}${map.month}${map.day}`;
}

function withinLookback(date: string, now: Date, lookbackHours: number) {
  const timestamp = Date.parse(date.length === 10 ? `${date}T23:59:59Z` : date);
  return Number.isFinite(timestamp)
    && timestamp <= now.getTime() + 24 * 60 * 60 * 1000
    && timestamp >= now.getTime() - lookbackHours * 60 * 60 * 1000;
}

async function scanOpenDart(input: {
  now: Date;
  lookbackHours: number;
  fetchImpl: FetchLike;
  apiKey?: string;
}) {
  const apiKey = input.apiKey?.trim();
  if (!apiKey) return { status: "missing_key" as const, events: [] as LargeCapDisclosureEvent[], note: "DART_API_KEY가 없어 국내 대형주 감지는 대기 중입니다." };
  const start = new Date(input.now.getTime() - input.lookbackHours * 60 * 60 * 1000);
  const params = new URLSearchParams({
    crtfc_key: apiKey,
    bgn_de: kstDate(start),
    end_de: kstDate(input.now),
    corp_cls: "Y",
    last_reprt_at: "Y",
    page_count: "100",
    sort: "date",
    sort_mth: "desc",
  });
  try {
    const response = await input.fetchImpl(`https://opendart.fss.or.kr/api/list.json?${params.toString()}`, {
      signal: AbortSignal.timeout(requestTimeoutMs()),
    });
    if (!response.ok) throw new Error(`OpenDART HTTP ${response.status}`);
    const payload = await response.json() as {
      status?: string;
      message?: string;
      list?: Array<{ corp_name?: string; report_nm?: string; rcept_no?: string; rcept_dt?: string }>;
    };
    if (payload.status === "013") return { status: "ready" as const, events: [] as LargeCapDisclosureEvent[] };
    if (payload.status && payload.status !== "000") throw new Error(`OpenDART ${payload.status}: ${payload.message ?? "조회 실패"}`);
    const companies = configuredList(process.env.STOCK_BLOG_KR_LARGE_CAP_NAMES, DEFAULT_KR_LARGE_CAP_NAMES);
    const events = (payload.list ?? []).flatMap<LargeCapDisclosureEvent>((item) => {
      const company = item.corp_name?.trim() ?? "";
      const title = item.report_nm?.trim() ?? "";
      const receipt = item.rcept_no?.trim() ?? "";
      const receiptDate = item.rcept_dt?.trim() ?? "";
      if (!company || !title || !receipt || !companies.some((name) => company.includes(name)) || !DART_MATERIAL_PATTERN.test(title)) return [];
      const filedAt = receiptDate.length === 8
        ? `${receiptDate.slice(0, 4)}-${receiptDate.slice(4, 6)}-${receiptDate.slice(6, 8)}`
        : input.now.toISOString();
      return [{
        market: "KR",
        company,
        eventType: DART_EARNINGS_PATTERN.test(title) ? "earnings" : "material_disclosure",
        title: `${company} ${title}`,
        filedAt,
        sourceUrl: `https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${encodeURIComponent(receipt)}`,
        sourceName: "OpenDART",
        summary: `${company}이 OpenDART에 '${title}' 공시를 제출했습니다. 원문 숫자와 비교 기준을 확인합니다.`,
      }];
    });
    return { status: "ready" as const, events };
  } catch (error) {
    return { status: "error" as const, events: [] as LargeCapDisclosureEvent[], note: error instanceof Error ? error.message : "OpenDART 조회 실패" };
  }
}

type SecTickerEntry = { cik_str?: number; ticker?: string; title?: string };
type SecRecentFilings = {
  accessionNumber?: string[];
  filingDate?: string[];
  reportDate?: string[];
  form?: string[];
  primaryDocument?: string[];
  items?: string[];
};

async function scanSecEdgar(input: { now: Date; lookbackHours: number; fetchImpl: FetchLike }) {
  const headers = {
    "User-Agent": process.env.SEC_EDGAR_USER_AGENT?.trim() || "BGCompany/1.0 bgcompanyoffice.cloud",
    Accept: "application/json",
  };
  try {
    const tickerResponse = await input.fetchImpl("https://www.sec.gov/files/company_tickers.json", {
      headers,
      signal: AbortSignal.timeout(requestTimeoutMs()),
    });
    if (!tickerResponse.ok) throw new Error(`SEC ticker HTTP ${tickerResponse.status}`);
    const tickerPayload = await tickerResponse.json() as Record<string, SecTickerEntry>;
    const wanted = new Set(configuredList(process.env.STOCK_BLOG_US_LARGE_CAP_SYMBOLS, DEFAULT_US_LARGE_CAP_SYMBOLS).map((symbol) => symbol.toUpperCase()));
    const targets = Object.values(tickerPayload).filter((entry) => wanted.has((entry.ticker ?? "").toUpperCase()));
    const fetchCompany = async (entry: SecTickerEntry) => {
      const cik = String(entry.cik_str ?? "").padStart(10, "0");
      if (!/^\d{10}$/.test(cik)) return [] as LargeCapDisclosureEvent[];
      const response = await input.fetchImpl(`https://data.sec.gov/submissions/CIK${cik}.json`, {
        headers,
        signal: AbortSignal.timeout(requestTimeoutMs()),
      });
      if (!response.ok) throw new Error(`SEC submissions ${entry.ticker ?? cik} HTTP ${response.status}`);
      const payload = await response.json() as { name?: string; filings?: { recent?: SecRecentFilings } };
      const recent = payload.filings?.recent;
      const forms = recent?.form ?? [];
      return forms.flatMap<LargeCapDisclosureEvent>((form, index) => {
        const filedAt = recent?.filingDate?.[index] ?? "";
        const items = recent?.items?.[index] ?? "";
        const isEarnings = SEC_EARNINGS_FORMS.has(form) || (form === "8-K" && items.split(",").map((item) => item.trim()).includes("2.02"));
        const material8K = form === "8-K" && items.split(",").map((item) => item.trim()).some((item) => SEC_MATERIAL_8K_ITEMS.has(item));
        if ((!isEarnings && !material8K) || !withinLookback(filedAt, input.now, input.lookbackHours)) return [];
        const accession = recent?.accessionNumber?.[index] ?? "";
        const primaryDocument = recent?.primaryDocument?.[index] ?? "";
        const accessionPath = accession.replaceAll("-", "");
        const cikPath = String(Number.parseInt(cik, 10));
        const sourceUrl = accessionPath && primaryDocument
          ? `https://www.sec.gov/Archives/edgar/data/${cikPath}/${accessionPath}/${primaryDocument}`
          : `https://www.sec.gov/edgar/browse/?CIK=${cikPath}`;
        const company = payload.name?.trim() || entry.title?.trim() || entry.ticker || cik;
        const symbol = entry.ticker?.toUpperCase();
        return [{
          market: "US",
          company,
          symbol,
          eventType: isEarnings ? "earnings" : "material_disclosure",
          title: `${company} ${form} 공식 제출`,
          filedAt,
          sourceUrl,
          sourceName: "SEC EDGAR",
          summary: `${company}(${symbol ?? ""})이 SEC에 ${form}${items ? ` · Item ${items}` : ""}을 제출했습니다. 공식 원문의 실적·가이던스·주요 경영사항을 확인합니다.`,
        }];
      });
    };
    const results: LargeCapDisclosureEvent[][] = [];
    const errors: string[] = [];
    for (let index = 0; index < targets.length; index += 5) {
      const batch = await Promise.allSettled(targets.slice(index, index + 5).map(fetchCompany));
      for (const item of batch) {
        if (item.status === "fulfilled") results.push(item.value);
        else errors.push(item.reason instanceof Error ? item.reason.message : "SEC 기업 제출 조회 실패");
      }
    }
    if (targets.length > 0 && results.length === 0 && errors.length > 0) throw new Error(errors.join(" / "));
    return {
      status: "ready" as const,
      events: results.flat(),
      note: errors.length > 0 ? `일부 SEC 기업 조회 실패: ${errors.slice(0, 3).join(" / ")}` : undefined,
    };
  } catch (error) {
    return { status: "error" as const, events: [] as LargeCapDisclosureEvent[], note: error instanceof Error ? error.message : "SEC EDGAR 조회 실패" };
  }
}

export async function scanLargeCapDisclosureEvents(options: {
  now?: Date;
  lookbackHours?: number;
  fetchImpl?: FetchLike;
  dartApiKey?: string;
} = {}): Promise<LargeCapDisclosureScanResult> {
  const now = options.now ?? new Date();
  const lookbackHours = options.lookbackHours ?? 36;
  const fetchImpl = options.fetchImpl ?? fetch;
  const [dart, sec] = await Promise.all([
    scanOpenDart({ now, lookbackHours, fetchImpl, apiKey: options.dartApiKey ?? process.env.DART_API_KEY }),
    scanSecEdgar({ now, lookbackHours, fetchImpl }),
  ]);
  const events = [...dart.events, ...sec.events]
    .sort((left, right) => Date.parse(right.filedAt) - Date.parse(left.filedAt))
    .filter((event, index, all) => all.findIndex((candidate) => candidate.sourceUrl === event.sourceUrl) === index)
    .slice(0, 3);
  return {
    checkedAt: now.toISOString(),
    events,
    providers: { openDart: dart.status, secEdgar: sec.status },
    notes: [dart.note, sec.note].filter((note): note is string => Boolean(note)),
  };
}

export function largeCapEventsToReferenceItems(events: LargeCapDisclosureEvent[]): ReferenceItem[] {
  const collectedAt = new Date().toISOString();
  return events.map((event, index) => ({
    id: `official-large-cap-${event.market.toLowerCase()}-${index}-${event.filedAt.replace(/\D/g, "")}`,
    sourceType: "disclosure",
    provider: event.sourceName === "OpenDART" ? "opendart" : "sec-edgar",
    title: event.title,
    url: event.sourceUrl,
    originalUrl: event.sourceUrl,
    publisher: event.sourceName,
    sourceName: event.sourceName,
    publishedAt: event.filedAt,
    collectedAt,
    summary: event.summary,
    keywords: [event.company, event.symbol, event.eventType === "earnings" ? "실적" : "공시"].filter((value): value is string => Boolean(value)),
    relevanceScore: 1,
    usageNote: "공식 원문의 발표값과 비교 기준을 우선 확인",
    copyrightPolicy: "공식 자료의 사실과 수치만 요약하고 원문 링크를 표시",
    contentType: "LARGE_CAP_DISCLOSURE_EARNINGS",
    market: event.market,
    symbols: event.symbol ? [event.symbol] : undefined,
    reliability: "official",
  }));
}
