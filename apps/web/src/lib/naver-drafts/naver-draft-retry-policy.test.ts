import test from "node:test";
import assert from "node:assert/strict";
import {
  evaluateNaverDraftSafeRetry,
  getNaverDraftSafeRetryLimit,
  shouldActivateNaverPublishCircuitBreaker,
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

test("발행 전 네이버 이미지 캡션 입력 실패는 안전 재시도한다", () => {
  assert.deepEqual(
    evaluateNaverDraftSafeRetry({
      status: "image_quality_failed",
      allowPublish: true,
      publishAttemptCount: 0,
      retryCount: 0,
      retryLimit: 2,
      errorCode: "NAVER_IMAGE_QUALITY_FAILED",
      errorMessage: "NAVER_IMAGE_CAPTION_INSERT_FAILED_fx-and-us-yields",
    }),
    { allowed: true, nextRetryCount: 1 },
  );
});

test("발행 전 네이버 이미지 위치 검증 실패도 안전 재시도한다", () => {
  assert.deepEqual(
    evaluateNaverDraftSafeRetry({
      status: "image_quality_failed",
      allowPublish: true,
      publishAttemptCount: 0,
      retryCount: 0,
      retryLimit: 2,
      errorCode: "NAVER_IMAGE_QUALITY_FAILED",
      errorMessage: "NAVER_IMAGE_PLACEMENT_VERIFY_FAILED_kospi-investor-flow_caption_not_found_images_4",
    }),
    { allowed: true, nextRetryCount: 1 },
  );
});

test("발행 전 네이버 이미지 캡션 레이아웃 실패도 안전 재시도한다", () => {
  assert.deepEqual(
    evaluateNaverDraftSafeRetry({
      status: "image_quality_failed",
      allowPublish: true,
      publishAttemptCount: 0,
      retryCount: 0,
      retryLimit: 2,
      errorCode: "NAVER_IMAGE_QUALITY_FAILED",
      errorMessage: "NAVER_IMAGE_CAPTION_LAYOUT_FAILED_major-index-change",
    }),
    { allowed: true, nextRetryCount: 1 },
  );
});

test("콘텐츠 자체의 이미지 품질 실패는 같은 원고로 자동 재시도하지 않는다", () => {
  const decision = evaluateNaverDraftSafeRetry({
    status: "image_quality_failed",
    allowPublish: true,
    publishAttemptCount: 0,
    retryCount: 0,
    retryLimit: 2,
    errorCode: "NAVER_IMAGE_QUALITY_FAILED",
    errorMessage: "IMAGE_METADATA_INCOMPLETE",
  });

  assert.equal(decision.allowed, false);
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

test("안전 재시도 한도는 기본 8회, 최대 12회다", () => {
  assert.equal(getNaverDraftSafeRetryLimit(), 8);
  assert.equal(getNaverDraftSafeRetryLimit("20"), 12);
  assert.equal(getNaverDraftSafeRetryLimit("invalid"), 8);
});

test("발행 버튼 전 오류는 다음 예약 글을 막는 전역 차단기를 켜지 않는다", () => {
  for (const status of [
    "failed",
    "publish_blocked",
    "readability_failed",
    "image_upload_failed",
    "image_quality_failed",
    "draft_save_failed",
    "quality_failed",
    "reference_failed",
    "market_data_failed",
  ]) {
    assert.equal(shouldActivateNaverPublishCircuitBreaker({ status, allowPublish: true }), false);
  }
});

test("발행 결과 불확실 또는 네이버 보안 오류만 전역 차단기를 켠다", () => {
  for (const status of ["publish_failed", "login_required", "captcha_required", "security_check_required"]) {
    assert.equal(shouldActivateNaverPublishCircuitBreaker({ status, allowPublish: true }), true);
  }
  assert.equal(shouldActivateNaverPublishCircuitBreaker({ status: "publish_failed", allowPublish: false }), false);
});
