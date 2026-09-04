import test from "node:test";
import assert from "node:assert/strict";
import { isAllowedNaverPublishedResult, parseNaverPublishedUrl } from "./naver-published-url-policy.ts";

const postId = "223123456789";

test("실제 네이버 게시글 URL에서 숫자형 post id와 blog id만 추출한다", () => {
  assert.deepEqual(parseNaverPublishedUrl(`https://blog.naver.com/bgmarketnote/${postId}`), { blogId: "bgmarketnote", postId });
  assert.deepEqual(parseNaverPublishedUrl(`https://m.blog.naver.com/bgmarketnote/${postId}?from=postView#anchor`), { blogId: "bgmarketnote", postId });
  assert.deepEqual(parseNaverPublishedUrl(`https://blog.naver.com/PostView.naver?blogId=bgmarketnote&logNo=${postId}`), { blogId: "bgmarketnote", postId });
});

test("홈·목록·작성·비숫자·외부 호스트 URL은 공개 성공으로 인정하지 않는다", () => {
  for (const value of [
    "https://blog.naver.com/",
    "https://blog.naver.com/PostList.naver?blogId=bgmarketnote",
    "https://blog.naver.com/PostWriteForm.naver?blogId=bgmarketnote",
    "https://blog.naver.com/bgmarketnote/not-a-number",
    "https://blog.naver.com/PostView.naver?blogId=bgmarketnote&logNo=abc",
    `http://blog.naver.com/bgmarketnote/${postId}`,
    `https://example.com/bgmarketnote/${postId}`,
  ]) {
    assert.equal(parseNaverPublishedUrl(value), null, value);
  }
});

test("서버는 URL post id·보고 post id·대상 blog id가 모두 일치해야 성공을 수락한다", () => {
  const url = `https://blog.naver.com/bgmarketnote/${postId}`;
  assert.equal(isAllowedNaverPublishedResult({ url, reportedPostId: postId, expectedBlogId: "bgmarketnote" }), true);
  assert.equal(isAllowedNaverPublishedResult({ url, reportedPostId: "223000000000", expectedBlogId: "bgmarketnote" }), false);
  assert.equal(isAllowedNaverPublishedResult({ url, reportedPostId: ` ${postId} `, expectedBlogId: "bgmarketnote" }), false);
  assert.equal(isAllowedNaverPublishedResult({ url, reportedPostId: postId, expectedBlogId: "otherblog" }), false);
});
