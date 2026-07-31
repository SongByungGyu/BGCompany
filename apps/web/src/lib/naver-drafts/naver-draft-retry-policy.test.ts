import test from "node:test";
import assert from "node:assert/strict";
import {
  evaluateNaverDraftSafeRetry,
  getNaverDraftSafeRetryLimit,
} from "./naver-draft-retry-policy.ts";

test("발행 전 이미지 업로드 실패는 설정 한도 안에서 자동 재시도한다", () => {
  assert.deepEqual(
    evaluateNaverDraftSafeRetry({
      status: "image_upload_failed",
      allowPublish: true,
      publishAttemptCount: 0,
      retryCount: 1,
      retryLimit: 2,
    }),
    { allowed: true, nextRetryCount: 2 },
  );
});

test("발행 버튼 이후 실패는 중복 게시 방지를 위해 자동 재시도하지 않는다", () => {
  const decision = evaluateNaverDraftSafeRetry({
    status: "publish_failed",
    allowPublish: true,
    publishAttemptCount: 1,
    retryCount: 0,
    retryLimit: 2,
  });

  assert.equal(decision.allowed, false);
  assert.match(decision.reason ?? "", /안전 재시도 대상|중복 게시/);
});

test("안전 재시도 한도는 기본 2회, 최대 5회다", () => {
  assert.equal(getNaverDraftSafeRetryLimit(), 2);
  assert.equal(getNaverDraftSafeRetryLimit("9"), 5);
  assert.equal(getNaverDraftSafeRetryLimit("invalid"), 2);
});
