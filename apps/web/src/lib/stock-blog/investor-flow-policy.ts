const SEOUL_TIME_ZONE = "Asia/Seoul";

function seoulDateParts(date: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: SEOUL_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = (type: "year" | "month" | "day") => parts.find((part) => part.type === type)?.value ?? "";
  return { year: value("year"), month: value("month"), day: value("day") };
}

function compactSeoulDate(date: Date) {
  const { year, month, day } = seoulDateParts(date);
  return `${year}${month}${day}`;
}

function previousSeoulCalendarDay(compactDate: string) {
  const year = Number(compactDate.slice(0, 4));
  const month = Number(compactDate.slice(4, 6));
  const day = Number(compactDate.slice(6, 8));
  return compactSeoulDate(new Date(Date.UTC(year, month - 1, day - 1, 3)));
}

function isWeekday(compactDate: string) {
  const year = Number(compactDate.slice(0, 4));
  const month = Number(compactDate.slice(4, 6));
  const day = Number(compactDate.slice(6, 8));
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return weekday !== 0 && weekday !== 6;
}

export function getInvestorFlowBusinessDateCandidates(
  contentType: string,
  now = new Date(),
  maximumCandidates = 5,
) {
  const limit = Math.max(1, Math.min(maximumCandidates, 7));
  let cursor = compactSeoulDate(now);
  if (contentType === "KOREA_DAILY_PREVIEW") cursor = previousSeoulCalendarDay(cursor);

  const candidates: string[] = [];
  while (candidates.length < limit) {
    if (isWeekday(cursor)) candidates.push(cursor);
    cursor = previousSeoulCalendarDay(cursor);
  }
  return candidates;
}

export function hasMeaningfulInvestorFlowValues(values: readonly number[]) {
  return values.length === 3
    && values.every((value) => Number.isFinite(value))
    && values.some((value) => value !== 0);
}

function normalizedDateKey(value: string | undefined) {
  if (!value) return undefined;
  const isoMatch = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) return `${isoMatch[1]}${isoMatch[2]}${isoMatch[3]}`;
  const shortMatch = value.match(/^(\d{2})\/(\d{2})\/(\d{2})$/);
  if (shortMatch) return `20${shortMatch[1]}${shortMatch[2]}${shortMatch[3]}`;
  const compactMatch = value.match(/^(\d{4})(\d{2})(\d{2})$/);
  return compactMatch ? value : undefined;
}

export function isInvestorFlowDateEligible(
  contentType: string,
  marketDate: string | undefined,
  asOfDates: readonly string[],
) {
  const normalizedMarketDate = normalizedDateKey(marketDate);
  const normalizedAsOfDates = asOfDates.map(normalizedDateKey);
  if (
    !normalizedMarketDate
    || normalizedAsOfDates.length !== 3
    || normalizedAsOfDates.some((value) => !value)
    || new Set(normalizedAsOfDates).size !== 1
  ) return false;

  const flowDate = normalizedAsOfDates[0]!;
  return contentType === "KOREA_DAILY_PREVIEW"
    ? flowDate < normalizedMarketDate
    : flowDate <= normalizedMarketDate;
}

export function buildInvestorFlowChartCopy(
  contentType: string,
  asOfLabel: string,
  valueSubtitle: string,
) {
  if (contentType === "KOREA_DAILY_PREVIEW") {
    return {
      title: `전일 KOSPI 투자자별 확정 수급｜${asOfLabel}`,
      subtitle: "오늘 수급 전망치가 아닙니다. 환율·선물 조건과 함께 연속 여부를 확인합니다.",
      caption: `${asOfLabel} 확정 수급입니다. 오늘은 환율·선물 흐름과 함께 연속·반전 여부를 확인합니다.`,
    };
  }
  return {
    title: "KOSPI 투자자별 순매수 비교",
    subtitle: valueSubtitle,
    caption: "외국인·기관·개인의 KOSPI 순매수 비교",
  };
}

export function formatInvestorFlowChartValues(values: readonly number[]) {
  const maxAbs = Math.max(...values.map((value) => Math.abs(value)), 0);
  const useTrillionWon = maxAbs >= 100_000;
  const divisor = useTrillionWon ? 1_000_000 : 100;
  const unit = useTrillionWon ? "조원" : "억원";
  return {
    unit,
    subtitle: useTrillionWon
      ? "백만원 단위 원자료를 조원으로 환산했습니다."
      : "작은 수급도 구분되도록 백만원 단위 원자료를 억원으로 환산했습니다.",
    values: values.map((value) => {
      const converted = value / divisor;
      return {
        value: converted,
        display: `${converted > 0 ? "+" : ""}${converted.toFixed(2)}${unit}`,
      };
    }),
  };
}
