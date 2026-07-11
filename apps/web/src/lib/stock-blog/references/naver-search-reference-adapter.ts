import { buildReferenceQueries } from "./reference-query-builder";
import { collectMarketSnapshot } from "./market-snapshot-provider";
import { dedupeReferenceItems, normalizeReferenceItem, sourceNameFromUrl, stripHtml, summarizeReferenceItems } from "./reference-normalizer";
import type { CompetitorBlogReference, ReferenceAdapter, ReferenceBundle, ReferenceItem, ReferenceSearchInput } from "./reference-types";

type NaverNewsItem = {
  title?: string;
  originallink?: string;
  link?: string;
  description?: string;
  pubDate?: string;
};

type NaverBlogItem = {
  title?: string;
  link?: string;
  description?: string;
  bloggername?: string;
  postdate?: string;
};

function parseNaverDate(value?: string) {
  if (!value) return undefined;
  if (/^\d{8}$/.test(value)) return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T00:00:00.000Z`;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

async function searchNaver<T>(kind: "news" | "blog", query: string, clientId: string, clientSecret: string, display: number) {
  const response = await fetch(`https://openapi.naver.com/v1/search/${kind}.json?display=${display}&sort=date&query=${encodeURIComponent(query)}`, {
    headers: { "X-Naver-Client-Id": clientId, "X-Naver-Client-Secret": clientSecret },
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) return [] as T[];
  const data = await response.json() as { items?: T[] };
  return data.items ?? [];
}

function disabledBundle(input: ReferenceSearchInput, queries: string[], enabled: boolean): Promise<ReferenceBundle> {
  return collectMarketSnapshot(input).then((marketSnapshot) => ({
    provider: "naver-search",
    mode: "real-disabled",
    status: enabled ? "needs_credentials" : "disabled",
    requiredEnv: enabled ? ["NAVER_SEARCH_CLIENT_ID", "NAVER_SEARCH_CLIENT_SECRET"] : ["REFERENCE_SEARCH_ENABLE_REAL_API"],
    contentType: input.contentType,
    generatedAt: new Date().toISOString(),
    marketDate: marketSnapshot.marketDate,
    market: input.market,
    queries,
    items: [],
    competitorBlogReferences: [],
    marketSnapshot,
    keyThemes: ["뉴스 참고자료 대기"],
    repeatedKeywords: [],
    differentiationPoints: ["필요한 환경변수가 준비된 뒤에만 실제 검색을 실행합니다."],
    cautionNotes: ["mock으로 대체하지 않으며 Hermes 실행 전 차단합니다."],
    sourcePolicy: "실제 검색 API는 명시적으로 활성화되고 credentials가 준비된 경우에만 사용합니다.",
    missingItems: enabled ? ["NAVER_SEARCH_CLIENT_ID", "NAVER_SEARCH_CLIENT_SECRET"] : ["REFERENCE_SEARCH_ENABLE_REAL_API=true"],
  }));
}

export const naverSearchReferenceAdapter: ReferenceAdapter = {
  async search(input: ReferenceSearchInput): Promise<ReferenceBundle> {
    const queries = buildReferenceQueries(input);
    const enabled = process.env.REFERENCE_SEARCH_ENABLE_REAL_API === "true";
    const clientId = process.env.NAVER_SEARCH_CLIENT_ID?.trim();
    const clientSecret = process.env.NAVER_SEARCH_CLIENT_SECRET?.trim();
    if (!enabled || !clientId || !clientSecret) return disabledBundle(input, queries, enabled);

    const maxResults = Math.max(5, Math.min(input.maxResults ?? 10, 20));
    const items: ReferenceItem[] = [];
    for (const query of queries.slice(0, 6)) {
      const found = await searchNaver<NaverNewsItem>("news", query, clientId, clientSecret, Math.min(maxResults, 10));
      for (const [index, item] of found.entries()) {
        const originalUrl = item.originallink;
        const url = originalUrl ?? item.link;
        const sourceName = sourceNameFromUrl(url);
        const publishedAt = parseNaverDate(item.pubDate);
        if (!url || !publishedAt) continue;
        items.push(normalizeReferenceItem({
          id: `naver-news-${query}-${index}`,
          sourceType: "news",
          provider: "naver-search",
          title: item.title ?? query,
          url,
          originalUrl,
          publisher: sourceName,
          sourceName,
          publishedAt,
          collectedAt: new Date().toISOString(),
          summary: item.description,
          query,
          keywords: query.split(/\s+/).slice(0, 6),
          relevanceScore: 0.95 - index * 0.04,
          reliability: sourceName?.endsWith("go.kr") || sourceName?.endsWith("or.kr") ? "official" : "major_media",
          usageNote: "제목·짧은 설명·원문 링크를 근거로 자체 문장으로 재구성합니다.",
        }));
      }
    }
    const dedupedItems = dedupeReferenceItems(items).slice(0, maxResults);

    const competitorBlogReferences: CompetitorBlogReference[] = [];
    if (process.env.COMPETITOR_BLOG_SEARCH_ENABLED === "true") {
      const seeds = (process.env.COMPETITOR_BLOG_SEEDS ?? "cpath").split(",").map((value) => value.trim()).filter(Boolean);
      const blogQueries = Array.from(new Set([...seeds.map((seed) => `${input.topic} ${seed}`), ...queries.slice(0, 3)]));
      for (const query of blogQueries.slice(0, 4)) {
        const found = await searchNaver<NaverBlogItem>("blog", query, clientId, clientSecret, 5);
        for (const item of found) {
          if (!item.link || !item.title || !item.postdate) continue;
          competitorBlogReferences.push({
            title: stripHtml(item.title),
            description: item.description ? stripHtml(item.description) : undefined,
            url: item.link,
            blogName: item.bloggername || sourceNameFromUrl(item.link),
            publishedAt: parseNaverDate(item.postdate),
            keywords: query.split(/\s+/).slice(0, 6),
            observedStructure: ["검색 노출 제목 패턴", "짧은 도입 후 소제목 중심", "참고 링크와 체크리스트 배치"],
            differentiationPoint: "검색 설명을 복사하지 않고 공식 근거·시장 데이터·자체 체크리스트로 차별화",
          });
        }
      }
    }
    const uniqueCompetitors = Array.from(new Map(competitorBlogReferences.map((item) => [item.url, item])).values()).slice(0, 10);
    const marketSnapshot = await collectMarketSnapshot(input);
    const summary = summarizeReferenceItems(dedupedItems);
    const missingItems: string[] = [];
    if (dedupedItems.length < 5) missingItems.push("실제 뉴스 참고자료 5개");
    if (uniqueCompetitors.length < 3) missingItems.push("경쟁 블로그 참고자료 3개");
    if (marketSnapshot.status !== "ready" || marketSnapshot.dataQuality !== "verified") missingItems.push(...marketSnapshot.missingItems);

    return {
      provider: "naver-search",
      mode: "real",
      status: missingItems.length ? "needs_reference" : "ready",
      contentType: input.contentType,
      generatedAt: new Date().toISOString(),
      marketDate: marketSnapshot.marketDate,
      market: input.market,
      queries,
      items: dedupedItems,
      competitorBlogReferences: uniqueCompetitors,
      marketSnapshot,
      keyThemes: summary.keyThemes,
      repeatedKeywords: summary.repeatedKeywords,
      differentiationPoints: summary.differentiationPoints,
      cautionNotes: ["게시 전 원문 맥락과 최신성을 다시 확인합니다.", "기사 문장·사진·블로그 본문을 그대로 복사하지 않습니다."],
      sourcePolicy: "검색 결과의 제목·짧은 설명·출처·발행일·링크만 사용하고 본문은 자체 문장으로 재구성합니다.",
      missingItems: Array.from(new Set(missingItems)),
    };
  },
};
