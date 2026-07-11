import { normalizeReferenceItem, summarizeReferenceItems } from "./reference-normalizer";
import { getStockReferenceTemplate } from "./stock-reference-templates";
import type { ReferenceBundle, ReferenceItem, ReferenceSearchInput } from "./reference-types";

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function buildId(prefix: string, index: number) {
  return `${prefix}-${index + 1}`;
}

export function normalizeStockReferenceItem(raw: unknown, input: ReferenceSearchInput, index: number): ReferenceItem | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const title = clean(record.title);
  const publisher = clean(record.publisher);
  const summary = clean(record.summary);
  const url = clean(record.url);
  if (!title && !summary) return null;
  const sourceType = (clean(record.sourceType) as ReferenceItem["sourceType"]) || "manual";
  const market = (clean(record.market) as ReferenceItem["market"]) || input.market;
  const reliability = (clean(record.reliability) as ReferenceItem["reliability"]) || "manual";
  const symbols = Array.isArray(record.symbols) ? record.symbols.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : undefined;
  const keywords = Array.isArray(record.keywords) ? record.keywords.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : input.keywords;
  return normalizeReferenceItem({
    id: clean(record.id) || buildId(`manual-ref-${input.contentType}`, index),
    sourceType,
    provider: clean(record.provider) || "manual",
    title,
    url: url || undefined,
    publisher: publisher || undefined,
    publishedAt: clean(record.publishedAt) || undefined,
    summary: summary || undefined,
    query: clean(record.query) || undefined,
    keywords,
    relevanceScore: typeof record.relevanceScore === "number" ? record.relevanceScore : undefined,
    usageNote: clean(record.usageNote) || "출처 링크와 요약을 바탕으로 자체 문장으로 재구성합니다.",
    copyrightPolicy: clean(record.copyrightPolicy) || "기사 전문/문장을 복사하지 않고 요약 신호로만 사용합니다.",
    contentType: input.contentType,
    market,
    symbols,
    reliability,
  });
}

export function buildManualReferenceBundle(input: ReferenceSearchInput, rawReferences: unknown[], options?: { generatedAt?: string; marketDate?: string; summary?: string; risks?: string[]; missingItems?: string[] }): ReferenceBundle {
  const template = getStockReferenceTemplate(input.contentType);
  const items = rawReferences.map((item, index) => normalizeStockReferenceItem(item, input, index)).filter((item): item is ReferenceItem => Boolean(item));
  const summary = summarizeReferenceItems(items);
  return {
    provider: "manual",
    mode: items.length > 0 ? "real" : "real-disabled",
    status: items.length > 0 ? "ready" : "needs_reference",
    contentType: input.contentType,
    generatedAt: options?.generatedAt ?? new Date().toISOString(),
    marketDate: options?.marketDate ?? new Date().toISOString().slice(0, 10),
    market: input.market,
    queries: input.keywords?.length ? input.keywords : template.requirements.flatMap((item) => item.keywords).slice(0, 8),
    items,
    competitorBlogReferences: [],
    keyThemes: summary.keyThemes,
    repeatedKeywords: summary.repeatedKeywords,
    differentiationPoints: summary.differentiationPoints,
    cautionNotes: [
      ...(options?.risks ?? []),
      "수동 참고자료는 원문 확인 후 요약 신호로만 사용합니다.",
      "매수·매도 추천으로 표현하지 않습니다.",
    ],
    sourcePolicy: "수동 입력된 링크/요약을 참고하되 기사 전문을 복사하지 않고 자체 문장으로 재구성합니다.",
    summary: options?.summary ?? `${template.label} 수동 참고자료 ${items.length}개`,
    risks: options?.risks ?? [],
    missingItems: options?.missingItems ?? [],
  };
}
