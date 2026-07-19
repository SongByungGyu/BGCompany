import { buildReferenceQueries } from "./reference-query-builder";
import { analyzeCompetitorBlogReference, summarizeCompetitorStructures } from "./competitor-blog-structure-analyzer";
import { isAllowedFredDegradedSnapshot } from "./fred-degraded-policy";
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

const NEXT_WEEK_NEWS_CORE_PATTERN = /증시|주식시장|코스피|코스닥|S&P\s*500|나스닥|기업\s*실적|실적\s*시즌/i;
const NEXT_WEEK_NEWS_DRIVER_PATTERN = /다음\s*주|전망|금리|국채|환율|외국인|기관|수급|경제\s*지표|ECB|연준|변동성/i;
const NEXT_WEEK_NEWS_EXCLUDED_TITLE_PATTERN = /뉴스브리핑|코인|가상자산|암호화폐|비트코인|BONK|금시세|금값|금가격/i;
const NEXT_WEEK_NEWS_EXCLUDED_PUBLISHERS = new Set(["tokenpost.kr"]);

export function isRelevantNextWeekNews(item: Pick<ReferenceItem, "title" | "summary" | "publisher" | "publishedAt">, nowMs = Date.now()) {
  const title = stripHtml(item.title || "");
  const summary = stripHtml(item.summary || "");
  const publisher = (item.publisher || "").toLowerCase();
  if (NEXT_WEEK_NEWS_EXCLUDED_PUBLISHERS.has(publisher)) return false;
  if (NEXT_WEEK_NEWS_EXCLUDED_TITLE_PATTERN.test(title)) return false;
  const publishedAt = Date.parse(item.publishedAt || "");
  if (!Number.isFinite(publishedAt) || nowMs - publishedAt > 14 * 24 * 60 * 60 * 1000 || publishedAt - nowMs > 24 * 60 * 60 * 1000) return false;
  const searchable = `${title}\n${summary}`;
  return NEXT_WEEK_NEWS_CORE_PATTERN.test(searchable) && NEXT_WEEK_NEWS_DRIVER_PATTERN.test(searchable);
}

function nextWeekNewsScore(item: ReferenceItem) {
  const searchable = `${item.title}\n${item.summary || ""}`;
  const signals = [
    /다음\s*주/i,
    /증시|주식시장/i,
    /코스피|코스닥/i,
    /S&P\s*500|나스닥/i,
    /실적\s*시즌|기업\s*실적/i,
    /금리|국채|환율|수급|ECB|연준/i,
  ].filter((pattern) => pattern.test(searchable)).length;
  return signals * 10 + (item.relevanceScore || 0);
}

export function selectDiverseNextWeekNews(items: ReferenceItem[], limit: number, nowMs = Date.now()) {
  const sorted = items.filter((item) => isRelevantNextWeekNews(item, nowMs)).sort((left, right) => nextWeekNewsScore(right) - nextWeekNewsScore(left));
  const selected: ReferenceItem[] = [];
  const publisherCounts = new Map<string, number>();
  for (const maxPerPublisher of [1, 2]) {
    for (const item of sorted) {
      if (selected.length >= limit) break;
      if (selected.includes(item)) continue;
      const publisher = (item.publisher || item.sourceName || "unknown").toLowerCase();
      const count = publisherCounts.get(publisher) || 0;
      if (count >= maxPerPublisher) continue;
      publisherCounts.set(publisher, count + 1);
      selected.push(item);
    }
  }
  return selected;
}

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
    const deduped = dedupeReferenceItems(items);
    const dedupedItems = input.contentType === "NEXT_WEEK_MARKET_PREVIEW"
      ? selectDiverseNextWeekNews(deduped, maxResults)
      : deduped.slice(0, maxResults);

    const competitorBlogReferences: CompetitorBlogReference[] = [];
    if (process.env.COMPETITOR_BLOG_SEARCH_ENABLED === "true") {
      const seeds = (process.env.COMPETITOR_BLOG_SEEDS ?? "주간증시,코스피전망,미국증시전망,다음주증시,장전브리핑").split(",").map((value) => value.trim()).filter(Boolean);
      const blogQueries = Array.from(new Set([...seeds, ...queries.slice(0, 3)]));
      for (const query of blogQueries.slice(0, 6)) {
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
            observedStructure: ["검색 결과 메타데이터 수집 완료"],
            differentiationPoint: "검색 설명을 복사하지 않고 공식 근거·시장 데이터·자체 체크리스트로 차별화",
          });
        }
      }
    }
    const uniqueCompetitors = Array.from(new Map(competitorBlogReferences.map((item) => [item.url, item])).values()).slice(0, 10);
    const deepAnalysisEnabled = process.env.COMPETITOR_BLOG_DEEP_ANALYSIS_ENABLED === "true";
    const deepAnalysisLimit = Math.max(1, Math.min(Number(process.env.COMPETITOR_BLOG_DEEP_ANALYSIS_LIMIT ?? "5") || 5, 5));
    const deepAnalysisTimeoutMs = Math.max(1_000, Math.min(Number(process.env.COMPETITOR_BLOG_DEEP_ANALYSIS_TIMEOUT_MS ?? "10000") || 10_000, 30_000));
    const deepAnalysisMaxBytes = Math.max(100_000, Math.min(Number(process.env.COMPETITOR_BLOG_DEEP_ANALYSIS_MAX_BYTES ?? "750000") || 750_000, 1_500_000));
    const analyzedCompetitors = [...uniqueCompetitors];
    if (deepAnalysisEnabled) {
      for (let index = 0; index < Math.min(deepAnalysisLimit, analyzedCompetitors.length); index += 1) {
        analyzedCompetitors[index] = await analyzeCompetitorBlogReference(analyzedCompetitors[index], {
          maxBytes: deepAnalysisMaxBytes,
          timeoutMs: deepAnalysisTimeoutMs,
        });
      }
    }
    const competitorAnalysis = summarizeCompetitorStructures(analyzedCompetitors);
    const marketSnapshot = await collectMarketSnapshot(input);
    const summary = summarizeReferenceItems(dedupedItems);
    const missingItems: string[] = [];
    if (dedupedItems.length < 5) missingItems.push("실제 뉴스 참고자료 5개");
    if (analyzedCompetitors.length < 3) missingItems.push("경쟁 블로그 참고자료 3개");
    const usableMarketSnapshot = (
      marketSnapshot.status === "ready" && marketSnapshot.dataQuality === "verified"
    ) || isAllowedFredDegradedSnapshot(marketSnapshot);
    if (!usableMarketSnapshot) missingItems.push(...marketSnapshot.missingItems);

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
      competitorBlogReferences: analyzedCompetitors,
      competitorAnalysis,
      marketSnapshot,
      keyThemes: summary.keyThemes,
      repeatedKeywords: summary.repeatedKeywords,
      differentiationPoints: Array.from(new Set([...summary.differentiationPoints, ...competitorAnalysis.differentiationOpportunities])),
      cautionNotes: ["게시 전 원문 맥락과 최신성을 다시 확인합니다.", "기사 문장·사진·블로그 본문을 그대로 복사하지 않습니다.", competitorAnalysis.copyrightPolicy],
      sourcePolicy: "뉴스는 제목·짧은 설명·출처·발행일·링크만 사용합니다. 경쟁 블로그는 본문 문장을 저장하지 않고 글자 수·문단·소제목·이미지·체크리스트·출처·유의문구 등 구조 지표만 사용합니다.",
      missingItems: Array.from(new Set(missingItems)),
    };
  },
};
