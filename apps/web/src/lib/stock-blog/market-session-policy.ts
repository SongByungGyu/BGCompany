import type { StockBlogContentType } from "@/lib/stock-blog/stock-blog-workflow";

export type StockMarketCode = "KRX" | "NYSE";
export type StockMarketSessionState = "open" | "closed" | "unknown";

export type StockMarketSession = {
  market: StockMarketCode;
  marketDate: string;
  state: StockMarketSessionState;
  source: string;
  reason: string;
};

export type StockBlogMarketSessionDecision = {
  action: "run" | "skip" | "defer";
  dependency: StockMarketCode | null;
  reason?: string;
  session?: StockMarketSession;
};

const CONTENT_MARKET_DEPENDENCY: Partial<Record<StockBlogContentType, StockMarketCode>> = {
  KOREA_DAILY_PREVIEW: "KRX",
  KOREA_MARKET_CLOSE_US_PREVIEW: "NYSE",
};

function parseIsoDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? date : null;
}

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function parseDateList(value?: string) {
  return new Set((value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter((item) => parseIsoDate(item)));
}

export function getConfiguredMarketDateOverride(input: {
  market: StockMarketCode;
  marketDate: string;
  closedDates?: string;
  openDates?: string;
}): StockMarketSession | null {
  const closed = parseDateList(input.closedDates).has(input.marketDate);
  const open = parseDateList(input.openDates).has(input.marketDate);
  if (closed && open) {
    return {
      market: input.market,
      marketDate: input.marketDate,
      state: "unknown",
      source: "operator-override",
      reason: "같은 날짜가 개장일·휴장일 예외 목록에 동시에 있습니다.",
    };
  }
  if (!closed && !open) return null;
  return {
    market: input.market,
    marketDate: input.marketDate,
    state: open ? "open" : "closed",
    source: "operator-override",
    reason: open ? "운영자가 지정한 임시 개장일입니다." : "운영자가 지정한 임시 휴장일입니다.",
  };
}

export function getKrxMarketSession(
  marketDate: string,
  reviewedCalendar: { closedDates?: string; openDates?: string } = {},
): StockMarketSession {
  const configured = getConfiguredMarketDateOverride({ market: "KRX", marketDate, ...reviewedCalendar });
  if (configured) {
    return {
      ...configured,
      source: configured.state === "unknown" ? configured.source : "krx-reviewed-calendar",
      reason: configured.state === "open"
        ? "공식 KRX 일정에서 개장일로 검토된 날짜입니다."
        : configured.state === "closed"
          ? "공식 KRX 일정에서 휴장일로 검토된 날짜입니다."
          : configured.reason,
    };
  }
  const date = parseIsoDate(marketDate);
  if (!date) {
    return { market: "KRX", marketDate, state: "unknown", source: "krx-reviewed-calendar", reason: "유효하지 않은 시장 날짜입니다." };
  }
  if (date.getUTCDay() === 0 || date.getUTCDay() === 6) {
    return { market: "KRX", marketDate, state: "closed", source: "krx-reviewed-calendar", reason: "국내 증시 주말 휴장입니다." };
  }
  return {
    market: "KRX",
    marketDate,
    state: "open",
    source: "krx-reviewed-calendar",
    reason: "검토된 KRX 휴장일 목록에 해당하지 않는 평일입니다.",
  };
}

function observedHoliday(year: number, month: number, day: number) {
  const holiday = new Date(Date.UTC(year, month, day));
  if (holiday.getUTCDay() === 6) holiday.setUTCDate(holiday.getUTCDate() - 1);
  if (holiday.getUTCDay() === 0) holiday.setUTCDate(holiday.getUTCDate() + 1);
  return holiday;
}

function nthWeekday(year: number, month: number, weekday: number, occurrence: number) {
  const first = new Date(Date.UTC(year, month, 1));
  const offset = (weekday - first.getUTCDay() + 7) % 7;
  return new Date(Date.UTC(year, month, 1 + offset + (occurrence - 1) * 7));
}

function lastWeekday(year: number, month: number, weekday: number) {
  const last = new Date(Date.UTC(year, month + 1, 0));
  const offset = (last.getUTCDay() - weekday + 7) % 7;
  last.setUTCDate(last.getUTCDate() - offset);
  return last;
}

function easterSunday(year: number) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

function nyseHolidayDates(year: number) {
  const holidays = [
    observedHoliday(year, 0, 1),
    nthWeekday(year, 0, 1, 3),
    nthWeekday(year, 1, 1, 3),
    lastWeekday(year, 4, 1),
    observedHoliday(year, 5, 19),
    observedHoliday(year, 6, 4),
    nthWeekday(year, 8, 1, 1),
    nthWeekday(year, 10, 4, 4),
    observedHoliday(year, 11, 25),
  ];
  const goodFriday = easterSunday(year);
  goodFriday.setUTCDate(goodFriday.getUTCDate() - 2);
  holidays.push(goodFriday);
  return holidays;
}

export function getNyseMarketSession(
  marketDate: string,
  overrides: { closedDates?: string; openDates?: string } = {},
): StockMarketSession {
  const configured = getConfiguredMarketDateOverride({ market: "NYSE", marketDate, ...overrides });
  if (configured) return configured;
  const date = parseIsoDate(marketDate);
  if (!date) {
    return { market: "NYSE", marketDate, state: "unknown", source: "nyse-rule-calendar", reason: "유효하지 않은 시장 날짜입니다." };
  }
  if (date.getUTCDay() === 0 || date.getUTCDay() === 6) {
    return { market: "NYSE", marketDate, state: "closed", source: "nyse-rule-calendar", reason: "미국 증시 주말 휴장입니다." };
  }
  const year = date.getUTCFullYear();
  const holidays = [year - 1, year, year + 1].flatMap(nyseHolidayDates).map(isoDate);
  if (holidays.includes(marketDate)) {
    return { market: "NYSE", marketDate, state: "closed", source: "nyse-rule-calendar", reason: "미국 거래소 정규 휴장일입니다." };
  }
  return { market: "NYSE", marketDate, state: "open", source: "nyse-rule-calendar", reason: "미국 거래소 정규 개장일입니다." };
}

export function getStockBlogMarketDependency(contentType: StockBlogContentType) {
  return CONTENT_MARKET_DEPENDENCY[contentType] ?? null;
}

export function evaluateStockBlogMarketSession(input: {
  contentType: StockBlogContentType;
  session?: StockMarketSession;
}): StockBlogMarketSessionDecision {
  const dependency = getStockBlogMarketDependency(input.contentType);
  if (!dependency) return { action: "run", dependency: null };
  if (!input.session || input.session.market !== dependency || input.session.state === "unknown") {
    return {
      action: "defer",
      dependency,
      session: input.session,
      reason: `${dependency} 개장 여부를 확인하지 못해 시장 의존 글을 보류합니다.`,
    };
  }
  if (input.session.state === "closed") {
    return {
      action: "skip",
      dependency,
      session: input.session,
      reason: `${input.session.reason} 휴장일 시장 전망은 발행하지 않습니다.`,
    };
  }
  return { action: "run", dependency, session: input.session };
}

export function addIsoDays(marketDate: string, days: number) {
  const date = parseIsoDate(marketDate);
  if (!date) return marketDate;
  date.setUTCDate(date.getUTCDate() + days);
  return isoDate(date);
}
