import test from "node:test";
import assert from "node:assert/strict";
import {
  appendRelatedPostSection,
  buildNaverDiscoveryTags,
  buildRecentTitleAvoidanceGuideline,
  selectRelatedPublishedPosts,
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

test("최근 발행 제목 회피 가이드는 최대 6개 제목만 포함한다", () => {
  const guideline = buildRecentTitleAvoidanceGuideline(Array.from({ length: 8 }, (_, index) => `제목 ${index + 1}`));
  assert.match(guideline ?? "", /제목 6/);
  assert.doesNotMatch(guideline ?? "", /제목 7/);
});
