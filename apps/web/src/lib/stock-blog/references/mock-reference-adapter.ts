import { buildReferenceQueries } from "./reference-query-builder";
import { normalizeReferenceItem, summarizeReferenceItems } from "./reference-normalizer";
import type { ReferenceAdapter, ReferenceBundle, ReferenceSearchInput } from "./reference-types";

const keywordSeeds = ["코스피", "코스닥", "환율", "금리", "외국인 수급", "반도체", "미국장", "실적"];

export const mockReferenceAdapter: ReferenceAdapter = {
  async search(input: ReferenceSearchInput): Promise<ReferenceBundle> {
    const queries = buildReferenceQueries(input);
    const items = queries.slice(0, input.maxResults ?? 5).map((query, index) => normalizeReferenceItem({
      id: `mock-ref-${input.contentType}-${index + 1}`,
      sourceType: index % 3 === 0 ? "news" : index % 3 === 1 ? "market_data" : "blog",
      provider: "mock",
      title: `[참고 신호] ${query}`,
      publisher: index % 2 === 0 ? "Mock Market Desk" : "BG Reference Lab",
      publishedAt: new Date(Date.now() - index * 60 * 60 * 1000).toISOString(),
      summary: `${query}와 관련된 시장 흐름을 확인하기 위한 mock 참고자료입니다. 실제 외부 API를 호출하지 않았습니다.`,
      query,
      keywords: keywordSeeds.slice(index, index + 4),
      relevanceScore: 0.92 - index * 0.06,
      usageNote: "문장 복사가 아니라 브리핑 관점 정리에만 활용합니다.",
    }));
    const summary = summarizeReferenceItems(items);
    return {
      provider: "mock",
      mode: "mock",
      contentType: input.contentType,
      generatedAt: new Date().toISOString(),
      market: input.market,
      queries,
      items,
      competitorBlogReferences: items
        .filter((item) => item.sourceType === "blog")
        .slice(0, 3)
        .map((item, index) => ({
          title: item.title,
          description: item.summary,
          url: item.url,
          blogName: item.publisher ?? "Mock Blog Desk",
          keywords: item.keywords ?? [],
          observedStructure: ["시장 한 줄 요약", "핵심 변수", "투자자 체크리스트", "주의사항"],
          differentiationPoint: index === 0
            ? "단순 뉴스 요약보다 수급·섹터·이벤트를 함께 묶어 차별화합니다."
            : "원문 표현을 복사하지 않고 BG Market Note 관점으로 재구성합니다.",
        })),
      keyThemes: summary.keyThemes,
      repeatedKeywords: summary.repeatedKeywords,
      differentiationPoints: summary.differentiationPoints,
      cautionNotes: ["mock 참고자료입니다. 게시 전 실제 뉴스/공시/지수 확인이 필요합니다.", "특정 종목 매수·매도 추천으로 표현하지 않습니다."],
      sourcePolicy: "외부 원문을 복사하지 않고 제목/요약 수준의 참고 신호로만 사용합니다.",
    };
  },
};
