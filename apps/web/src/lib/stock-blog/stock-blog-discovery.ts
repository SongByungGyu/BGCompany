import type { StockBriefingTemplate } from "@/features/content-pipeline/content-pipeline-types";

export type PublishedPostCandidate = {
  title: string;
  url: string;
};

const GENERIC_KEYWORDS = new Set([
  "오늘",
  "이번",
  "다음",
  "한국",
  "미국",
  "증시",
  "시장",
  "주식",
  "전망",
  "정리",
  "브리핑",
  "체크",
  "체크포인트",
]);

export const STOCK_BLOG_DISCOVERY_GUIDELINES = [
  "제목 앞에는 날짜가 아니라 독자가 검색할 핵심 이슈·종목·지표를 두고 날짜는 제목 끝에 둡니다.",
  "포괄적인 장전·마감 브리핑 표현만 쓰지 말고 검증 데이터에서 확인된 숫자·지수·환율·업종·이벤트 중 가장 구체적인 검색 의도 하나를 제목과 도입부에 연결합니다.",
  "도입부 첫 3문장 안에 시장 움직임, 확인된 원인, 투자자가 볼 변수를 먼저 답하고 뒤에서 근거를 설명합니다.",
  "SEO 키워드는 같은 뜻을 반복하지 않는 구체 검색어 5~8개만 제안하고, CTA에는 독자가 답하기 쉬운 질문 하나를 포함합니다.",
];

function normalizedTagKey(value: string) {
  return value.toLocaleLowerCase("ko-KR").replace(/[\s#_\-·|｜/]+/g, "");
}

function cleanTag(value: string) {
  return value
    .replace(/^#+/, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 30);
}

export function buildNaverDiscoveryTags(input: {
  seoKeywords: string[];
  requiredTags: string[];
  brandTag?: string;
  maxTags?: number;
}) {
  const maxTags = Math.min(8, Math.max(5, input.maxTags ?? 8));
  const brandTag = cleanTag(input.brandTag ?? "BGMarketNote");
  const result: string[] = [];
  const seen = new Set<string>();
  for (const candidate of [...input.seoKeywords, ...input.requiredTags]) {
    const tag = cleanTag(candidate);
    const key = normalizedTagKey(tag);
    if (tag.length < 2 || !key || seen.has(key)) continue;
    seen.add(key);
    result.push(tag);
    if (result.length >= maxTags - 1) break;
  }
  const brandKey = normalizedTagKey(brandTag);
  if (brandTag && !seen.has(brandKey)) result.push(brandTag);
  return result.slice(0, maxTags);
}

function titleTokens(value: string) {
  return new Set(value
    .toLocaleLowerCase("ko-KR")
    .split(/[^0-9a-z가-힣]+/i)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2 && !GENERIC_KEYWORDS.has(item)));
}

function isNaverBlogUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && (url.hostname === "blog.naver.com" || url.hostname.endsWith(".blog.naver.com"));
  } catch {
    return false;
  }
}

export function selectRelatedPublishedPosts(input: {
  currentTitle: string;
  posts: PublishedPostCandidate[];
  limit?: number;
}) {
  const currentTokens = titleTokens(input.currentTitle);
  const currentKey = normalizedTagKey(input.currentTitle);
  const ranked = input.posts
    .filter((post) => post.title.trim() && isNaverBlogUrl(post.url) && normalizedTagKey(post.title) !== currentKey)
    .map((post, index) => {
      const overlap = [...titleTokens(post.title)].filter((token) => currentTokens.has(token)).length;
      return { post, index, overlap };
    })
    .sort((a, b) => b.overlap - a.overlap || a.index - b.index);
  return ranked.slice(0, Math.min(3, Math.max(1, input.limit ?? 2))).map(({ post }) => post);
}

export function appendRelatedPostSection(input: {
  body: string;
  template: StockBriefingTemplate;
  posts: PublishedPostCandidate[];
}) {
  if (input.template === "NEXT_WEEK_MARKET_PREVIEW" || input.posts.length === 0 || input.body.includes("함께 읽으면 좋은 글")) {
    return input.body;
  }
  const relatedText = input.posts
    .slice(0, 2)
    .map((post) => `- ${post.title}\n${post.url}`)
    .join("\n\n");
  const section = `함께 읽으면 좋은 글\n\n${relatedText}`;
  const marker = "\n\n마무리\n\n";
  const result = input.body.includes(marker)
    ? input.body.replace(marker, `\n\n${section}${marker}`)
    : `${input.body.trim()}\n\n${section}`;
  if (result.length <= 3200) return result;
  if (input.posts.length > 1) return appendRelatedPostSection({ ...input, posts: input.posts.slice(0, 1) });
  return input.body;
}

export function buildRecentTitleAvoidanceGuideline(titles: string[]) {
  const recent = titles.map((title) => title.trim()).filter(Boolean).slice(0, 6);
  if (recent.length === 0) return null;
  return `최근 발행 제목과 같은 중심 문구를 반복하지 말고 오늘 검증된 다른 검색 각도를 선택합니다. 최근 제목: ${recent.join(" / ")}`;
}
