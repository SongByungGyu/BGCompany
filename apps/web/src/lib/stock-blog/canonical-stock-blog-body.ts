import {
  FRED_DEGRADED_DISCLOSURE,
  FRED_DEGRADED_LEGACY_DISCLOSURES,
  isAllowedFredDegradedSnapshot,
} from "./references/fred-degraded-policy.ts";
import {
  KIS_SECTOR_DEGRADED_DISCLOSURE,
  isAllowedKisSectorDegradedSnapshot,
} from "./references/kis-sector-degraded-policy.ts";
import {
  KIS_OVERSEAS_DEGRADED_DISCLOSURE,
  isAllowedKisOverseasDegradedSnapshot,
} from "./references/kis-overseas-degraded-policy.ts";
import type { MarketSnapshot, ReferenceItem } from "./references/reference-types.ts";
import { STOCK_BLOG_INVESTMENT_DISCLAIMER } from "./stock-blog-editorial-policy.ts";

export const STOCK_BLOG_SOURCE_HEADING = "함께 확인한 기사";
export const STOCK_BLOG_CANONICAL_SOURCE_COUNT = 3;

export type StockBlogSourceContractInspection = {
  ok: boolean;
  headingCount: number;
  entryCount: number;
  urlCount: number;
  allUrlCount: number;
  distinctUrlCount: number;
  expectedReferenceCount: number;
  conclusionBeforeSource: boolean;
  onlyDisclaimerAfterSource: boolean;
  orderedPairsMatch: boolean;
  missingTitles: string[];
  missingUrls: string[];
  unexpectedUrls: string[];
};

export type StockBlogTailContractInspection = {
  ok: boolean;
  disclaimerCount: number;
  disclaimerIsLast: boolean;
  fredDisclosureCount: number;
  kisSectorDisclosureCount: number;
  kisOverseasDisclosureCount: number;
  requiredDisclosures: string[];
  missingDisclosures: string[];
  unexpectedDisclosures: string[];
  disclosuresBeforeDisclaimer: boolean;
};

export type StockBlogQaStructuralAudit = {
  sourceContract: StockBlogSourceContractInspection;
  requiredRevisionCount: number;
};

function normalizeNewlines(value: string) {
  return value.replace(/\r\n?/g, "\n");
}

function normalizeInline(value?: string | null) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function normalizeHeading(value: string) {
  return value
    .trim()
    .replace(/^#{1,6}\s*/, "")
    .replace(/^\*\*(.*?)\*\*$/, "$1")
    .trim();
}

function isSourceHeading(value: string) {
  return normalizeHeading(value) === STOCK_BLOG_SOURCE_HEADING;
}

function isConclusionHeading(value: string) {
  return /^(?:\d+\.\s*)?마무리$/.test(normalizeHeading(value));
}

function isValidHttpUrl(value?: string) {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function countExact(body: string, value: string) {
  return body.split(value).length - 1;
}

function requiredMarketDataDisclosures(snapshot?: MarketSnapshot) {
  return [
    isAllowedFredDegradedSnapshot(snapshot) ? FRED_DEGRADED_DISCLOSURE : null,
    isAllowedKisSectorDegradedSnapshot(snapshot) ? KIS_SECTOR_DEGRADED_DISCLOSURE : null,
    isAllowedKisOverseasDegradedSnapshot(snapshot) ? KIS_OVERSEAS_DEGRADED_DISCLOSURE : null,
  ].filter((value): value is string => Boolean(value));
}

export function selectCanonicalStockBlogReferences(
  referenceItems: ReferenceItem[] = [],
  count = STOCK_BLOG_CANONICAL_SOURCE_COUNT,
) {
  const selected: ReferenceItem[] = [];
  const seenUrls = new Set<string>();
  for (const item of referenceItems) {
    if (item.sourceType !== "news") continue;
    const title = normalizeInline(item.title);
    const url = normalizeInline(item.url);
    if (!title || !isValidHttpUrl(url) || seenUrls.has(url)) continue;
    selected.push({ ...item, title, url });
    seenUrls.add(url);
    if (selected.length >= count) break;
  }
  return selected;
}

export function renderCanonicalStockBlogSourceSection(referenceItems: ReferenceItem[]) {
  const references = selectCanonicalStockBlogReferences(referenceItems);
  if (references.length !== STOCK_BLOG_CANONICAL_SOURCE_COUNT) return "";
  const entries = references.map((item, index) => {
    const source = normalizeInline(item.sourceName || item.publisher || item.provider);
    const publishedAt = normalizeInline(item.publishedAt)?.slice(0, 10);
    return [
      `${index + 1}. ${normalizeInline(item.title)}`,
      source ? `- 출처: ${source}` : null,
      publishedAt ? `- 발행일: ${publishedAt}` : null,
      `- 원문: ${normalizeInline(item.url)}`,
    ].filter((value): value is string => Boolean(value)).join("\n");
  });
  return [STOCK_BLOG_SOURCE_HEADING, ...entries].join("\n\n");
}

function sourceSectionBounds(body: string) {
  const lines = normalizeNewlines(body).split("\n");
  const start = lines.findIndex(isSourceHeading);
  if (start < 0) return { lines, start: -1, end: -1 };
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    const value = lines[index].trim();
    if (
      isConclusionHeading(value)
      || value === STOCK_BLOG_INVESTMENT_DISCLAIMER
      || value === FRED_DEGRADED_DISCLOSURE
      || FRED_DEGRADED_LEGACY_DISCLOSURES.includes(value as typeof FRED_DEGRADED_LEGACY_DISCLOSURES[number])
      || value === KIS_SECTOR_DEGRADED_DISCLOSURE
      || value === KIS_OVERSEAS_DEGRADED_DISCLOSURE
    ) {
      end = index;
      break;
    }
  }
  return { lines, start, end };
}

export function inspectStockBlogSourceContract(
  body: string,
  referenceItems: ReferenceItem[] = [],
): StockBlogSourceContractInspection {
  const normalizedBody = normalizeNewlines(body);
  const expectedReferences = selectCanonicalStockBlogReferences(referenceItems);
  const { lines, start, end } = sourceSectionBounds(normalizedBody);
  const articleLines = start >= 0 ? lines.slice(start + 1, end) : [];
  const titleEntries: Array<{ index: number; title: string; url?: string }> = [];
  const articleUrls: string[] = [];
  for (const line of articleLines) {
    const match = line.match(/^\s*([1-9]\d*)[.)]\s+(.+?)\s*$/);
    if (match) {
      titleEntries.push({ index: Number(match[1]), title: normalizeInline(match[2]) });
      continue;
    }
    const urlMatch = line.match(/^\s*-\s*원문\s*[:：]\s*(https?:\/\/\S+)\s*$/);
    if (urlMatch) {
      articleUrls.push(urlMatch[1]);
      const currentEntry = titleEntries.at(-1);
      if (currentEntry && currentEntry.url === undefined) currentEntry.url = urlMatch[1];
    }
  }
  const allSourceUrls = articleLines.flatMap((line) => (
    line.match(/https?:\/\/[^\s<>"']+/g) ?? []
  ));
  const distinctUrls = new Set(allSourceUrls);
  const entryCount = titleEntries.length;
  const headingCount = normalizedBody.split("\n").filter(isSourceHeading).length;
  const conclusionIndex = lines.findIndex(isConclusionHeading);
  const conclusionBeforeSource = start >= 0 && conclusionIndex >= 0 && conclusionIndex < start;
  const contentAfterSource = start >= 0
    ? lines.slice(end).map((line) => line.trim()).filter(Boolean)
    : [];
  const onlyDisclaimerAfterSource = contentAfterSource.length === 1 && contentAfterSource[0] === STOCK_BLOG_INVESTMENT_DISCLAIMER;
  const missingTitles = expectedReferences.flatMap((item, index) => {
    const title = normalizeInline(item.title);
    const exactEntry = titleEntries.some((entry) => entry.index === index + 1 && entry.title === title);
    return title && !exactEntry ? [title] : [];
  });
  const missingUrls = expectedReferences
    .map((item) => normalizeInline(item.url))
    .filter((url) => url && !distinctUrls.has(url));
  const expectedUrls = expectedReferences.map((item) => normalizeInline(item.url));
  const unexpectedUrls = Array.from(distinctUrls).filter((url) => !expectedUrls.includes(url));
  const orderedPairsMatch = expectedReferences.every((item, position) => {
    const entry = titleEntries[position];
    return entry?.index === position + 1
      && entry.title === normalizeInline(item.title)
      && entry.url === normalizeInline(item.url);
  });
  const expectedReferenceCount = expectedReferences.length;
  const ok = headingCount === 1
    && expectedReferenceCount === STOCK_BLOG_CANONICAL_SOURCE_COUNT
    && entryCount === STOCK_BLOG_CANONICAL_SOURCE_COUNT
    && articleUrls.length === STOCK_BLOG_CANONICAL_SOURCE_COUNT
    && allSourceUrls.length === STOCK_BLOG_CANONICAL_SOURCE_COUNT
    && distinctUrls.size === STOCK_BLOG_CANONICAL_SOURCE_COUNT
    && conclusionBeforeSource
    && onlyDisclaimerAfterSource
    && orderedPairsMatch
    && missingTitles.length === 0
    && missingUrls.length === 0
    && unexpectedUrls.length === 0;
  return {
    ok,
    headingCount,
    entryCount,
    urlCount: articleUrls.length,
    allUrlCount: allSourceUrls.length,
    distinctUrlCount: distinctUrls.size,
    expectedReferenceCount,
    conclusionBeforeSource,
    onlyDisclaimerAfterSource,
    orderedPairsMatch,
    missingTitles,
    missingUrls,
    unexpectedUrls,
  };
}

function removeExistingSourceSections(body: string) {
  const lines = normalizeNewlines(body).split("\n");
  const kept: string[] = [];
  let insertionIndex: number | undefined;
  let index = 0;
  while (index < lines.length) {
    if (!isSourceHeading(lines[index])) {
      kept.push(lines[index]);
      index += 1;
      continue;
    }
    insertionIndex ??= kept.length;
    index += 1;
    while (index < lines.length) {
      const value = lines[index].trim();
      if (
        isSourceHeading(value)
        || isConclusionHeading(value)
        || value === STOCK_BLOG_INVESTMENT_DISCLAIMER
        || value === FRED_DEGRADED_DISCLOSURE
        || FRED_DEGRADED_LEGACY_DISCLOSURES.includes(value as typeof FRED_DEGRADED_LEGACY_DISCLOSURES[number])
        || value === KIS_SECTOR_DEGRADED_DISCLOSURE
        || value === KIS_OVERSEAS_DEGRADED_DISCLOSURE
      ) break;
      index += 1;
    }
  }
  return { lines: kept, insertionIndex };
}

export function normalizeStockBlogSourceSection(body: string, referenceItems: ReferenceItem[] = []) {
  const sourceSection = renderCanonicalStockBlogSourceSection(referenceItems);
  if (!sourceSection) return normalizeNewlines(body).trim();
  const withoutSources = removeExistingSourceSections(body);
  const lines = [...withoutSources.lines];
  const conclusionIndex = lines.findIndex(isConclusionHeading);
  const disclaimerIndex = lines.findIndex((line) => line.trim() === STOCK_BLOG_INVESTMENT_DISCLAIMER);
  const insertAt = disclaimerIndex >= 0 ? disclaimerIndex : lines.length;
  if (conclusionIndex < 0 || conclusionIndex >= insertAt) return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  lines.splice(insertAt, 0, "", ...sourceSection.split("\n"), "");
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function normalizeStockBlogTail(body: string, snapshot?: MarketSnapshot) {
  let normalized = normalizeNewlines(body);
  for (const tailItem of [
    STOCK_BLOG_INVESTMENT_DISCLAIMER,
    FRED_DEGRADED_DISCLOSURE,
    ...FRED_DEGRADED_LEGACY_DISCLOSURES,
    KIS_SECTOR_DEGRADED_DISCLOSURE,
    KIS_OVERSEAS_DEGRADED_DISCLOSURE,
  ]) {
    normalized = normalized.split(tailItem).join("");
  }
  normalized = normalized
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return [
    normalized,
    ...requiredMarketDataDisclosures(snapshot),
    STOCK_BLOG_INVESTMENT_DISCLAIMER,
  ].filter(Boolean).join("\n\n");
}

export function canonicalizeStockBlogBody(input: {
  body: string;
  referenceItems?: ReferenceItem[];
  marketSnapshot?: MarketSnapshot;
}) {
  const withTail = normalizeStockBlogTail(input.body, input.marketSnapshot);
  return normalizeStockBlogSourceSection(withTail, input.referenceItems);
}

export function inspectStockBlogTailContract(body: string, snapshot?: MarketSnapshot): StockBlogTailContractInspection {
  const normalized = normalizeNewlines(body).trimEnd();
  const disclaimerCount = countExact(normalized, STOCK_BLOG_INVESTMENT_DISCLAIMER);
  const disclaimerIndex = normalized.lastIndexOf(STOCK_BLOG_INVESTMENT_DISCLAIMER);
  const disclaimerIsLast = disclaimerCount === 1 && normalized.endsWith(STOCK_BLOG_INVESTMENT_DISCLAIMER);
  const requiredDisclosures = requiredMarketDataDisclosures(snapshot);
  const knownDisclosures = [
    FRED_DEGRADED_DISCLOSURE,
    ...FRED_DEGRADED_LEGACY_DISCLOSURES,
    KIS_SECTOR_DEGRADED_DISCLOSURE,
    KIS_OVERSEAS_DEGRADED_DISCLOSURE,
  ];
  const missingDisclosures = requiredDisclosures.filter((item) => countExact(normalized, item) !== 1);
  const unexpectedDisclosures = knownDisclosures.filter((item) => (
    !requiredDisclosures.includes(item) && countExact(normalized, item) > 0
  ));
  const disclosuresBeforeDisclaimer = disclaimerIndex >= 0 && requiredDisclosures.every((item) => {
    const index = normalized.indexOf(item);
    return index >= 0 && index < disclaimerIndex;
  });
  const fredDisclosureCount = countExact(normalized, FRED_DEGRADED_DISCLOSURE);
  const kisSectorDisclosureCount = countExact(normalized, KIS_SECTOR_DEGRADED_DISCLOSURE);
  const kisOverseasDisclosureCount = countExact(normalized, KIS_OVERSEAS_DEGRADED_DISCLOSURE);
  return {
    ok: disclaimerIsLast
      && missingDisclosures.length === 0
      && unexpectedDisclosures.length === 0
      && disclosuresBeforeDisclaimer
      && fredDisclosureCount <= 1
      && kisSectorDisclosureCount <= 1
      && kisOverseasDisclosureCount <= 1,
    disclaimerCount,
    disclaimerIsLast,
    fredDisclosureCount,
    kisSectorDisclosureCount,
    kisOverseasDisclosureCount,
    requiredDisclosures,
    missingDisclosures,
    unexpectedDisclosures,
    disclosuresBeforeDisclaimer,
  };
}

export function inspectStockBlogQaStructuralAudit(input: {
  result: Record<string, unknown>;
  body: string;
  referenceItems?: ReferenceItem[];
}): StockBlogQaStructuralAudit {
  const requiredRevisions = Array.isArray(input.result.requiredRevisions)
    ? input.result.requiredRevisions.filter((item) => typeof item === "string" && item.trim().length > 0)
    : [];
  return {
    sourceContract: inspectStockBlogSourceContract(input.body, input.referenceItems),
    requiredRevisionCount: requiredRevisions.length,
  };
}
