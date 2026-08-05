import type { MarketSnapshot, StockReferenceBriefingTemplate } from "./references/reference-types.ts";
import { STOCK_BLOG_INVESTMENT_DISCLAIMER } from "./stock-blog-editorial-policy.ts";

export type VerifiedScheduleEvent = {
  date: string;
  event: string;
  market?: string;
  sourceName?: string;
  url: string;
};

export type VerifiedSchedule = {
  source: "marketSnapshot.upcoming";
  immutable: true;
  scope?: {
    marketDate?: string;
    contentType?: StockReferenceBriefingTemplate;
    from?: string;
    through?: string;
    markets: string[];
    missingMarkets: string[];
  };
  events: VerifiedScheduleEvent[];
};

export type VerifiedScheduleValidation = {
  ok: boolean;
  checkedEventCount: number;
  issues: string[];
};

type WriterSection = {
  heading?: string;
  body?: string;
};

type ApplyVerifiedScheduleResult = {
  result: Record<string, unknown>;
  validation: VerifiedScheduleValidation;
};

type ApplyVerifiedScheduleOptions = {
  contentType?: StockReferenceBriefingTemplate;
};

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const SCHEDULE_HEADING_PATTERN = /(?:주요\s*)?(?:경제\s*)?(?:일정|캘린더)|(?:다음|이번)\s*주.*(?:일정|이벤트)/i;
const MAX_VERIFIED_EVENTS = 12;

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeSections(value: unknown): WriterSection[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return null;
      const record = item as Record<string, unknown>;
      const heading = stringValue(record.heading);
      const body = stringValue(record.body);
      return heading || body ? { heading, body } : null;
    })
    .filter((item): item is { heading: string; body: string } => item !== null);
}

function addUtcDays(isoDate: string, days: number) {
  const date = new Date(`${isoDate}T00:00:00Z`);
  if (!Number.isFinite(date.getTime())) return undefined;
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function normalizeVerifiedEvents(snapshot?: MarketSnapshot, contentType?: StockReferenceBriefingTemplate) {
  const issues: string[] = [];
  if (!snapshot) {
    return { events: [] as VerifiedScheduleEvent[], issues: ["검증된 시장 스냅샷이 없습니다."], from: undefined, through: undefined };
  }
  if (!Array.isArray(snapshot.upcoming) || snapshot.upcoming.length === 0) {
    return { events: [] as VerifiedScheduleEvent[], issues: [], from: undefined, through: undefined };
  }

  const seen = new Set<string>();
  const events: VerifiedScheduleEvent[] = [];
  snapshot.upcoming.forEach((item, index) => {
    const date = stringValue(item.date);
    const event = stringValue(item.event);
    const url = stringValue(item.url);
    if (!ISO_DATE_PATTERN.test(date)) {
      issues.push(`upcoming[${index}] 날짜가 YYYY-MM-DD 형식이 아닙니다.`);
      return;
    }
    if (!event) {
      issues.push(`upcoming[${index}] 이벤트명이 없습니다.`);
      return;
    }
    const key = `${date}\u0000${event}`;
    if (seen.has(key)) return;
    seen.add(key);
    if (!/^https?:\/\//i.test(url)) {
      issues.push(`${date} ${event}: 원문 URL이 없습니다.`);
    }
    events.push({
      date,
      event,
      market: stringValue(item.market) || undefined,
      sourceName: stringValue(item.sourceName) || undefined,
      url,
    });
  });

  events.sort((left, right) => left.date.localeCompare(right.date) || left.event.localeCompare(right.event));
  if (!ISO_DATE_PATTERN.test(snapshot.marketDate)) {
    return { events: events.slice(0, MAX_VERIFIED_EVENTS), issues, from: undefined, through: undefined };
  }
  const dailyPreview = contentType === "KOREA_DAILY_PREVIEW" || contentType === "KOREA_MARKET_CLOSE_US_PREVIEW";
  if (contentType !== "NEXT_WEEK_MARKET_PREVIEW" && !dailyPreview) {
    return { events: events.slice(0, MAX_VERIFIED_EVENTS), issues, from: undefined, through: undefined };
  }
  const from = addUtcDays(snapshot.marketDate, contentType === "NEXT_WEEK_MARKET_PREVIEW" ? 1 : 0);
  const through = addUtcDays(snapshot.marketDate, 7);
  const scopedEvents = from && through
    ? events.filter((item) => item.date >= from && item.date <= through)
    : events;
  return { events: scopedEvents.slice(0, MAX_VERIFIED_EVENTS), issues, from, through };
}

function koreanScheduleDate(isoDate: string) {
  const date = new Date(`${isoDate}T00:00:00Z`);
  if (!Number.isFinite(date.getTime())) return isoDate;
  const weekdays = ["일요일", "월요일", "화요일", "수요일", "목요일", "금요일", "토요일"];
  return `${date.getUTCMonth() + 1}월 ${date.getUTCDate()}일 ${weekdays[date.getUTCDay()]}`;
}

function scheduleImportance(event: string, market?: string) {
  const normalized = event.toLowerCase();
  if (/fomc|federal open market/.test(normalized)) {
    return "통화정책 신호가 미국 국채금리와 기술주 투자심리를 바꿀지 주의해서 봐야 합니다.";
  }
  if (/foreign exchange|exchange rates|h\.10/.test(normalized)) {
    return "달러 흐름이 원·달러 환율과 외국인 수급 부담으로 이어지는지 살펴볼 필요가 있습니다.";
  }
  if (/selected interest rates|h\.15|treasury/.test(normalized)) {
    return "미국 단기·장기 금리의 방향이 성장주 밸류에이션에 미치는 영향을 확인해야 합니다.";
  }
  if (/employment cost|earnings|wage|salary/.test(normalized)) {
    return "임금 압력이 물가와 연준 정책 기대에 어떤 영향을 주는지 살펴봐야 합니다.";
  }
  if (/job openings|turnover|jolts/.test(normalized)) {
    return "노동 수요의 둔화 여부에 따라 미국 금리와 성장주 투자심리가 달라질 수 있습니다.";
  }
  if (/unemployment|employment|payroll/.test(normalized)) {
    return "고용 흐름이 경기 기대와 달러, 미국 국채금리에 미치는 반응을 확인할 필요가 있습니다.";
  }
  if (market === "KR") return `${event} 이후 국내 경기 기대와 원·달러 환율, 외국인 수급의 반응을 함께 봐야 합니다.`;
  if (market === "US") return `${event} 이후 미국 국채금리와 달러, 성장주 투자심리의 반응을 함께 확인해야 합니다.`;
  return `${event} 이후 글로벌 금리·환율과 위험선호가 어떻게 반응하는지 확인할 필요가 있습니다.`;
}

function renderScheduleBody(schedule: VerifiedSchedule) {
  const lines = schedule.events.map((item) => (
    `- ${koreanScheduleDate(item.date)}: ${item.event}\n  ${scheduleImportance(item.event, item.market)}`
  ));
  return lines.join("\n");
}

function scheduleHeading(schedule: VerifiedSchedule) {
  if (schedule.scope?.contentType === "NEXT_WEEK_MARKET_PREVIEW") return "4. 다음 주 핵심 일정";
  const markets = schedule.scope?.markets ?? [];
  if (markets.length === 1 && markets[0] === "US") return "검증된 미국 주요 일정";
  if (markets.length === 1 && markets[0] === "KR") return "검증된 한국 주요 일정";
  if (markets.includes("KR") && markets.includes("US")) return "검증된 한국·미국 주요 일정";
  return "검증된 주요 일정";
}

function normalizeMarketClassification(section: WriterSection): WriterSection {
  const heading = stringValue(section.heading);
  const body = stringValue(section.body);
  if (!/(?:강세.*약세|약세.*강세).*섹터|강세\s*\/\s*약세\s*섹터/i.test(heading)) return { heading, body };
  const normalizedHeading = heading.replace(/섹터/gi, "시장 항목");
  const normalizedBody = body
    .replace(/강세\s*섹터/g, "강세 시장 항목")
    .replace(/약세\s*섹터/g, "약세 시장 항목")
    .replace(/섹터\s*강세/g, "시장 항목 강세")
    .replace(/섹터\s*약세/g, "시장 항목 약세");
  const disclosure = "이 목록은 검증 스냅샷의 시장 강약 분류를 옮긴 것으로, 순수 업종 외에 지수·테마·상품이 포함될 수 있습니다.";
  return {
    heading: normalizedHeading,
    body: normalizedBody.includes(disclosure) ? normalizedBody : `${disclosure}\n${normalizedBody}`,
  };
}

function assembleDraft(input: {
  introduction: string;
  sections: WriterSection[];
  conclusion: string;
}) {
  const withoutDisclaimer = (value: string) => value.replaceAll(STOCK_BLOG_INVESTMENT_DISCLAIMER, "").trim();
  const plainParts: string[] = [];
  const markdownParts: string[] = [];
  const introduction = withoutDisclaimer(input.introduction);
  if (introduction) {
    plainParts.push(introduction);
    markdownParts.push(introduction);
  }
  for (const section of input.sections) {
    const heading = stringValue(section.heading);
    const body = withoutDisclaimer(stringValue(section.body));
    if (heading) {
      plainParts.push(heading);
      markdownParts.push(`## ${heading}`);
    }
    if (body) {
      plainParts.push(body);
      markdownParts.push(body);
    }
  }
  const conclusion = withoutDisclaimer(input.conclusion);
  if (conclusion) {
    plainParts.push("마무리", conclusion);
    markdownParts.push("## 마무리", conclusion);
  }
  plainParts.push(STOCK_BLOG_INVESTMENT_DISCLAIMER);
  markdownParts.push(STOCK_BLOG_INVESTMENT_DISCLAIMER);
  return {
    fullDraft: plainParts.join("\n\n"),
    markdownDraft: markdownParts.join("\n\n"),
  };
}

function normalizeMentionedDate(year: string | undefined, month: string, day: string, expectedYear: string) {
  return `${year || expectedYear}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

function extractDates(text: string, expectedYear: string) {
  const dates = new Set<string>();
  for (const match of text.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) {
    dates.add(`${match[1]}-${match[2]}-${match[3]}`);
  }
  for (const match of text.matchAll(/\b(\d{4})[./](\d{1,2})[./](\d{1,2})\b/g)) {
    dates.add(normalizeMentionedDate(match[1], match[2], match[3], expectedYear));
  }
  for (const match of text.matchAll(/(?:(\d{4})년\s*)?(\d{1,2})월\s*(\d{1,2})일/g)) {
    dates.add(normalizeMentionedDate(match[1], match[2], match[3], expectedYear));
  }
  return [...dates];
}

function validateSchedule(input: {
  result: Record<string, unknown>;
  scheduleBody: string;
  events: VerifiedScheduleEvent[];
  initialIssues: string[];
  requireEvents: boolean;
}): VerifiedScheduleValidation {
  const issues = [...input.initialIssues];
  if (input.requireEvents && input.events.length === 0) {
    issues.push("본문에 고정할 검증 일정이 없습니다.");
  }

  const title = stringValue(input.result.finalTitle);
  const metaDescription = stringValue(input.result.metaDescription);
  const fullDraft = stringValue(input.result.fullDraft);
  const publishableText = [title, metaDescription, fullDraft].filter(Boolean).join("\n");
  const segments = publishableText.split(/\n+|(?<=[.!?。])\s+/).map((item) => item.trim()).filter(Boolean);

  const eventsByName = new Map<string, { event: string; dates: Set<string> }>();
  for (const item of input.events) {
    const readableDate = koreanScheduleDate(item.date);
    if (!input.scheduleBody.includes(readableDate) || !input.scheduleBody.includes(item.event)) {
      issues.push(`${item.date} ${item.event}: 고정 일정 블록의 날짜·이벤트명이 일치하지 않습니다.`);
    }
    const normalizedEvent = item.event.toLowerCase();
    const grouped = eventsByName.get(normalizedEvent) ?? {
      event: item.event,
      dates: new Set<string>(),
    };
    grouped.dates.add(item.date);
    eventsByName.set(normalizedEvent, grouped);
  }

  for (const [normalizedEvent, grouped] of eventsByName) {
    const expectedDates = [...grouped.dates].sort();
    const expectedYear = expectedDates[0]?.slice(0, 4) ?? String(new Date().getUTCFullYear());
    for (const segment of segments) {
      if (!segment.toLowerCase().includes(normalizedEvent)) continue;
      const mentionedDates = extractDates(segment, expectedYear);
      const unexpectedDates = mentionedDates.filter((date) => !grouped.dates.has(date));
      if (unexpectedDates.length > 0) {
        issues.push(`${grouped.event}: 본문의 날짜 ${unexpectedDates.join(", ")}가 검증값 ${expectedDates.join(", ")}와 다릅니다.`);
        break;
      }
    }
  }

  return {
    ok: issues.length === 0,
    checkedEventCount: input.events.length,
    issues: [...new Set(issues)],
  };
}

export function applyVerifiedSchedule(
  writerResult: Record<string, unknown>,
  snapshot?: MarketSnapshot,
  options: ApplyVerifiedScheduleOptions = {},
): ApplyVerifiedScheduleResult {
  const { events: verifiedEvents, issues, from, through } = normalizeVerifiedEvents(snapshot, options.contentType);
  const originalSections = normalizeSections(writerResult.sections);
  if (originalSections.length === 0) issues.push("Writer sections가 없어 본문을 재조립할 수 없습니다.");
  const scheduleSections = originalSections.filter((section) => SCHEDULE_HEADING_PATTERN.test(stringValue(section.heading)));
  const writerScheduleText = scheduleSections.map((section) => stringValue(section.body)).join("\n").toLowerCase();
  const writerSelectedEvents = verifiedEvents.filter((item) => writerScheduleText.includes(item.event.toLowerCase()));
  const eventLimit = options.contentType === "NEXT_WEEK_MARKET_PREVIEW" ? 6 : 2;
  const events = (writerSelectedEvents.length > 0 ? writerSelectedEvents : verifiedEvents).slice(0, eventLimit);
  const markets = [...new Set(events.map((item) => item.market).filter((item): item is string => Boolean(item)))];
  const expectedMarkets = options.contentType === "NEXT_WEEK_MARKET_PREVIEW" ? ["KR", "US"] : [];
  const schedule: VerifiedSchedule = {
    source: "marketSnapshot.upcoming",
    immutable: true,
    scope: {
      marketDate: snapshot?.marketDate,
      contentType: options.contentType,
      from,
      through,
      markets,
      missingMarkets: expectedMarkets.filter((market) => !markets.includes(market)),
    },
    events,
  };
  const scheduleBody = renderScheduleBody(schedule);
  const sections: WriterSection[] = [];
  let scheduleInserted = false;
  for (const section of originalSections) {
    if (SCHEDULE_HEADING_PATTERN.test(stringValue(section.heading))) {
      if (!scheduleInserted && events.length > 0) {
        sections.push({ heading: stringValue(section.heading) || scheduleHeading(schedule), body: scheduleBody });
        scheduleInserted = true;
      }
      continue;
    }
    sections.push(normalizeMarketClassification(section));
  }
  if (!scheduleInserted && events.length > 0) {
    const articleIndex = sections.findIndex((section) => stringValue(section.heading).includes("함께 확인한 기사"));
    const scheduleSection = { heading: scheduleHeading(schedule), body: scheduleBody };
    if (articleIndex >= 0) sections.splice(articleIndex, 0, scheduleSection);
    else sections.push(scheduleSection);
  }

  const introduction = stringValue(writerResult.introduction);
  const conclusion = stringValue(writerResult.conclusion);
  const drafts = assembleDraft({ introduction, sections, conclusion });
  const result: Record<string, unknown> = {
    ...writerResult,
    sections,
    cta: STOCK_BLOG_INVESTMENT_DISCLAIMER,
    ...drafts,
    verifiedSchedule: schedule,
  };
  delete result.htmlDraft;
  const validation = validateSchedule({
    result,
    scheduleBody,
    events,
    initialIssues: issues,
    requireEvents: options.contentType === "NEXT_WEEK_MARKET_PREVIEW",
  });
  result.scheduleValidation = validation;
  return { result, validation };
}
