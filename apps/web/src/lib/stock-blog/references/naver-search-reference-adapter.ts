import { buildReferenceQueries } from "./reference-query-builder";
import { normalizeReferenceItem, summarizeReferenceItems } from "./reference-normalizer";
import type { ReferenceAdapter, ReferenceBundle, ReferenceSearchInput } from "./reference-types";

type NaverNewsItem = {
  title?: string;
  originallink?: string;
  link?: string;
  description?: string;
  pubDate?: string;
};

export const naverSearchReferenceAdapter: ReferenceAdapter = {
  async search(input: ReferenceSearchInput): Promise<ReferenceBundle> {
    const queries = buildReferenceQueries(input);
    const enabled = process.env.REFERENCE_SEARCH_ENABLE_REAL_API === "true";
    const clientId = process.env.NAVER_SEARCH_CLIENT_ID?.trim();
    const clientSecret = process.env.NAVER_SEARCH_CLIENT_SECRET?.trim();
    if (!enabled || !clientId || !clientSecret) {
      return {
        provider: "naver-search",
        mode: "real-disabled",
        contentType: input.contentType,
        generatedAt: new Date().toISOString(),
        market: input.market,
        queries,
        items: [],
        keyThemes: ["뉴스 참고자료 대기"],
        repeatedKeywords: [],
        differentiationPoints: ["REFERENCE_SEARCH_ENABLE_REAL_API=true와 네이버 검색 API 키 설정 후 실제 수집 가능"],
        cautionNotes: ["현재 운영 기본값은 외부 검색 API 비활성화입니다.", "비용/쿼터가 발생할 수 있어 자동 호출하지 않습니다."],
        sourcePolicy: "실제 검색 API는 명시적으로 활성화된 경우에만 사용합니다.",
      };
    }

    const items = [];
    for (const query of queries.slice(0, 3)) {
      const response = await fetch(`https://openapi.naver.com/v1/search/news.json?display=5&sort=date&query=${encodeURIComponent(query)}`, {
        headers: {
          "X-Naver-Client-Id": clientId,
          "X-Naver-Client-Secret": clientSecret,
        },
      });
      if (!response.ok) continue;
      const data = await response.json() as { items?: NaverNewsItem[] };
      for (const [index, item] of (data.items ?? []).entries()) {
        items.push(normalizeReferenceItem({
          id: `naver-${query}-${index}`,
          sourceType: "news",
          provider: "naver-search",
          title: item.title ?? query,
          url: item.originallink ?? item.link,
          publisher: "Naver News Search",
          publishedAt: item.pubDate ? new Date(item.pubDate).toISOString() : undefined,
          summary: item.description,
          query,
          keywords: query.split(/\s+/).slice(0, 5),
          relevanceScore: 0.9 - index * 0.05,
          usageNote: "원문 확인 후 요약/재구성에만 사용합니다.",
        }));
      }
    }
    const summary = summarizeReferenceItems(items);
    return {
      provider: "naver-search",
      mode: "real",
      contentType: input.contentType,
      generatedAt: new Date().toISOString(),
      market: input.market,
      queries,
      items,
      keyThemes: summary.keyThemes,
      repeatedKeywords: summary.repeatedKeywords,
      differentiationPoints: summary.differentiationPoints,
      cautionNotes: ["게시 전 원문 맥락과 최신성을 다시 확인합니다.", "기사 문장/사진을 그대로 복사하지 않습니다."],
      sourcePolicy: "검색 결과는 참고 신호로만 사용하고 본문은 자체 문장으로 재구성합니다.",
    };
  },
};
