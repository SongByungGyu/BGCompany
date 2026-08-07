import test from "node:test";
import assert from "node:assert/strict";
import {
  appendRelatedPostSection,
  buildNaverDiscoveryTags,
  buildRecentTitleAvoidanceGuideline,
  getStockBlogSearchIntentGuidelines,
  inspectPublishedPostSimilarity,
  selectRelatedPublishedPosts,
  STOCK_BLOG_DISCOVERY_GUIDELINES,
} from "./stock-blog-discovery.ts";

test("네이버 태그는 의미 중복을 제거하고 브랜드 포함 최대 8개로 제한한다", () => {
  const tags = buildNaverDiscoveryTags({
    seoKeywords: ["코스피 급락", "코스피급락", "삼성전자 주가", "원달러 환율", "외국인 수급", "반도체 전망", "오늘 미국장", "나스닥 전망"],
    requiredTags: ["한국증시", "코스피", "시장체크"],
  });
  assert.equal(tags.length, 8);
  assert.equal(tags.at(-1), "BGMarketNote");
  assert.equal(tags.filter((tag) => tag.replace(/\s/g, "") === "코스피급락").length, 1);
});

test("최근 게시글 중 현재 제목과 검색어가 겹치는 글을 우선 연결한다", () => {
  const posts = selectRelatedPublishedPosts({
    currentTitle: "코스피 급락 원인과 삼성전자 외국인 수급｜7월 29일",
    posts: [
      { title: "이번 주 미국 증시 일정", url: "https://blog.naver.com/bgmarketnote/1" },
      { title: "삼성전자 급락과 외국인 순매도 정리", url: "https://blog.naver.com/bgmarketnote/2" },
      { title: "원달러 환율 전망", url: "https://example.com/not-naver" },
    ],
  });
  assert.equal(posts[0]?.url, "https://blog.naver.com/bgmarketnote/2");
  assert.equal(posts.length, 2);
});

test("관련 글은 마무리 앞에 넣고 다음 주 프리뷰에는 외부 링크 계약상 넣지 않는다", () => {
  const posts = [{ title: "삼성전자 수급 정리", url: "https://blog.naver.com/bgmarketnote/2" }];
  const body = "도입\n\n마무리\n\n결론";
  const appended = appendRelatedPostSection({ body, template: "KOREA_DAILY_PREVIEW", posts });
  assert.match(appended, /함께 읽으면 좋은 글[\s\S]+마무리/);
  assert.equal(appendRelatedPostSection({ body, template: "NEXT_WEEK_MARKET_PREVIEW", posts }), body);
});

test("관련 글은 편집 정책의 본문 상한을 넘기면 추가하지 않는다", () => {
  const body = "가".repeat(2790);
  const posts = [{ title: "삼성전자 수급 정리", url: "https://blog.naver.com/bgmarketnote/2" }];

  assert.equal(appendRelatedPostSection({ body, template: "KOREA_DAILY_PREVIEW", posts }), body);
});

test("최근 발행 제목 회피 가이드는 최대 6개 제목만 포함한다", () => {
  const guideline = buildRecentTitleAvoidanceGuideline(Array.from({ length: 8 }, (_, index) => `제목 ${index + 1}`));
  assert.match(guideline ?? "", /제목 6/);
  assert.doesNotMatch(guideline ?? "", /제목 7/);
});

test("오전 한국장과 17시 미국장 글은 서로 다른 1차 검색 의도를 갖는다", () => {
  assert.match(getStockBlogSearchIntentGuidelines("KOREA_DAILY_PREVIEW").join(" "), /오늘 코스피 전망/);
  assert.match(getStockBlogSearchIntentGuidelines("KOREA_MARKET_CLOSE_US_PREVIEW").join(" "), /오늘 미국장 전망/);
  assert.match(getStockBlogSearchIntentGuidelines("KOREA_MARKET_CLOSE_US_PREVIEW").join(" "), /오늘 한국장 마감은.*2~3문장/);
});

test("검색 최적화가 댓글 질문형 CTA를 요구하지 않는다", () => {
  const guidelines = STOCK_BLOG_DISCOVERY_GUIDELINES.join("\n");
  assert.match(guidelines, /CTA는 만들지 않습니다/);
  assert.doesNotMatch(guidelines, /답하기 쉬운 질문/);
});

test("최근 글과 제목·본문이 사실상 같은 원고는 차단한다", () => {
  const repeatedBody = "외국인 수급과 원달러 환율을 확인합니다. 반도체 주도 업종의 거래대금을 점검합니다. ".repeat(20);
  const result = inspectPublishedPostSimilarity({
    title: "오늘 코스피 마감 원인과 외국인 수급｜8월 3일",
    body: repeatedBody,
    posts: [{
      title: "오늘 코스피 마감 원인과 외국인 수급｜8월 2일",
      body: repeatedBody,
      url: "https://blog.naver.com/bgmarketnote/3",
    }],
  });
  assert.equal(result.blocked, true);
  assert.equal(result.bodySimilarity, 1);
});

test("주제가 다른 최근 글은 유사 콘텐츠로 차단하지 않는다", () => {
  const result = inspectPublishedPostSimilarity({
    title: "원달러 환율 상승이 반도체 수출주에 미치는 영향｜8월 3일",
    body: "원달러 환율과 수출 채산성, 외국인 수급의 관계를 단계별로 살펴봅니다. ".repeat(12),
    posts: [{
      title: "미국 CPI 발표 일정과 나스닥 금리 변수｜8월 2일",
      body: "미국 소비자물가지수 발표 시간과 국채 금리, 성장주 밸류에이션을 점검합니다. ".repeat(12),
      url: "https://blog.naver.com/bgmarketnote/4",
    }],
  });
  assert.equal(result.blocked, false);
});
