import type { StockBriefingTemplate } from "@/features/content-pipeline/content-pipeline-types";
import { getStockBlogEditorialPolicy } from "./stock-blog-editorial-policy.ts";

export type PublishedPostCandidate = {
  title: string;
  url: string;
  body?: string;
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
  "SEO 키워드는 같은 뜻을 반복하지 않는 구체 검색어 5~8개만 제안하고, 댓글·공감·이웃·투표를 요구하는 CTA는 만들지 않습니다.",
  "마케팅 검토에서는 실제 검색 문장에 가까운 제목 후보를 정확히 3개 제안하고, 메인 키워드 선명도·구체성·최근 제목 중복·과장 표현을 비교해 추천 제목을 고릅니다.",
  "본문에는 반드시 'BG Market Note 판단' 섹션을 두고 기본 판단·상방 조건·하방 조건·판단이 바뀌는 확인 기준을 검증된 자료 안에서만 설명합니다.",
];

const TEMPLATE_SEARCH_INTENT_GUIDELINES: Record<StockBriefingTemplate, string[]> = {
  KOREA_DAILY_PREVIEW: [
    "오전 글의 1차 검색 의도는 '오늘 코스피 전망'입니다. 전일 한국장 마감은 짧은 코멘트로만 두고 간밤 미국 지수·금리와 원달러 환율이 오늘 한국장에 미칠 영향을 중심으로 씁니다.",
    "제목 후보에는 오늘 한국장·코스피 전망·장 시작 전 확인할 변수 중 하나를 앞쪽에 두고, 전일 한국장 마감 원인을 제목으로 다시 반복하지 않습니다.",
  ],
  KOREA_MARKET_CLOSE_US_PREVIEW: [
    "17시 글의 1차 검색 의도는 '오늘 미국장 전망' 또는 '오늘 나스닥 전망'입니다. 전일 미국 주요 지수를 짧게 복기하고 금리·달러·선물·실적·경제 일정을 오늘 밤 시나리오로 연결합니다.",
    "오늘 한국장 마감은 미국장과 연결되는 신호를 2~3문장으로만 사용합니다. 제목 후보에는 나스닥·S&P500·미국 금리·주요 일정 중 가장 구체적인 변수를 앞쪽에 두고 코스피 마감 원인을 메인 검색어로 사용하지 않습니다.",
  ],
  WEEKLY_MARKET_REVIEW: [
    "토요일 글의 1차 검색 의도는 '이번 주 증시 정리'입니다. 본문의 70% 이상을 이번 주 한국·미국 지수, 누적 수급, 주도 업종과 변동 원인에 배정하고 다음 주 내용은 다시 확인할 신호 3개로만 제한합니다.",
    "제목 후보에는 이번 주 증시 정리·코스피·나스닥·외국인 수급·주도 업종 중 구체적인 복기 변수를 앞쪽에 두고 다음 주 전망이나 일정은 메인 검색어로 사용하지 않습니다.",
  ],
  NEXT_WEEK_MARKET_PREVIEW: [
    "일요일 글의 1차 검색 의도는 '다음 주 증시 주요 이슈'와 '영향 섹터'입니다. 지난주 복기는 짧게 끝내고 본문의 70% 이상을 이슈 3개·영향 경로·경제 및 실적 일정·대응 조건에 배정합니다.",
    "제목 후보에는 다음 주 주요 이슈·수혜 섹터·주의 업종 중 구체적인 검색어를 앞쪽에 두고 단순 테마 나열은 피합니다.",
  ],
  INVESTMENT_STUDY: [
    "평일 12시 10분 글의 1차 검색 의도는 당일 시장 이슈를 이해하기 위한 하나의 구체적인 투자 개념입니다. 정의·전달 경로·실제 사례·흔한 오해를 한 글 안에서 해결합니다.",
    "제목 후보에는 코스피·나스닥·PPI·금리·반도체·실적 등 당일 이슈와 핵심 숫자 또는 질문을 앞에 두고 '투자 공부' 같은 포괄어만 제목으로 사용하지 않습니다.",
  ],
  LARGE_CAP_DISCLOSURE_EARNINGS: [
    "공시·실적 글의 1차 검색 의도는 공식 발표가 확인된 기업명과 핵심 숫자입니다. DART·SEC 원문을 기준으로 발표값과 비교 기준을 구분합니다.",
    "제목 후보에는 기업명·실적 또는 공시 종류·핵심 증감 숫자를 앞쪽에 두고 매수 추천이나 주가 방향을 단정하지 않습니다.",
  ],
};

export function getStockBlogSearchIntentGuidelines(template: StockBriefingTemplate) {
  return TEMPLATE_SEARCH_INTENT_GUIDELINES[template];
}

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

function similarityTokens(value: string) {
  return value
    .toLocaleLowerCase("ko-KR")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/(?:20)?\d{2}[-/.년]\s*\d{1,2}[-/.월]\s*\d{1,2}일?/g, " ")
    .replace(/\d{1,2}월\s*\d{1,2}(?:일|주차)/g, " ")
    .split(/[^0-9a-z가-힣%]+/i)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2 && !GENERIC_KEYWORDS.has(token));
}

function wordShingles(value: string, size = 4) {
  const tokens = similarityTokens(value);
  const shingles = new Set<string>();
  for (let index = 0; index <= tokens.length - size; index += 1) {
    shingles.add(tokens.slice(index, index + size).join(" "));
  }
  return shingles;
}

function jaccardSimilarity(left: Set<string>, right: Set<string>) {
  if (left.size === 0 || right.size === 0) return 0;
  const intersection = [...left].filter((item) => right.has(item)).length;
  return intersection / (left.size + right.size - intersection);
}

export type StockBlogSimilarityResult = {
  blocked: boolean;
  matchedTitle?: string;
  titleSimilarity: number;
  bodySimilarity: number;
  reason?: string;
};

export function inspectPublishedPostSimilarity(input: {
  title: string;
  body: string;
  posts: PublishedPostCandidate[];
}): StockBlogSimilarityResult {
  const currentTitleTokens = new Set(similarityTokens(input.title));
  const currentBodyShingles = wordShingles(input.body);
  let strongest: StockBlogSimilarityResult = {
    blocked: false,
    titleSimilarity: 0,
    bodySimilarity: 0,
  };
  for (const post of input.posts) {
    const titleSimilarity = jaccardSimilarity(currentTitleTokens, new Set(similarityTokens(post.title)));
    const bodySimilarity = post.body ? jaccardSimilarity(currentBodyShingles, wordShingles(post.body)) : 0;
    const exactTitle = normalizedTagKey(input.title) === normalizedTagKey(post.title);
    const blocked = exactTitle
      || titleSimilarity >= 0.78
      || bodySimilarity >= 0.42
      || (titleSimilarity >= 0.64 && bodySimilarity >= 0.28);
    const strength = Math.max(titleSimilarity, bodySimilarity);
    const strongestStrength = Math.max(strongest.titleSimilarity, strongest.bodySimilarity);
    if (strength <= strongestStrength) continue;
    strongest = {
      blocked,
      matchedTitle: post.title,
      titleSimilarity,
      bodySimilarity,
      reason: blocked
        ? `최근 글 '${post.title}'과 유사도가 높습니다(제목 ${Math.round(titleSimilarity * 100)}%, 본문 ${Math.round(bodySimilarity * 100)}%).`
        : undefined,
    };
  }
  return strongest;
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
  const maxBodyLength = getStockBlogEditorialPolicy(input.template).bodyLength.max;
  if (result.length <= maxBodyLength) return result;
  if (input.posts.length > 1) return appendRelatedPostSection({ ...input, posts: input.posts.slice(0, 1) });
  return input.body;
}

export function buildRecentTitleAvoidanceGuideline(titles: string[]) {
  const recent = titles.map((title) => title.trim()).filter(Boolean).slice(0, 6);
  if (recent.length === 0) return null;
  return `최근 발행 제목과 같은 중심 문구를 반복하지 말고 오늘 검증된 다른 검색 각도를 선택합니다. 최근 제목: ${recent.join(" / ")}`;
}
