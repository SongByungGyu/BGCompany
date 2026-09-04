import test from "node:test";
import assert from "node:assert/strict";
import {
  assertPublicContentPipelineInput,
  assertTrustedContentPipelineInput,
  type ContentPipelineInput,
} from "./content-pipeline-input.ts";

test("public input cannot inject a scheduler reference bundle", () => {
  const referenceBundle = { provider: "trusted-scheduler" };
  const result = assertPublicContentPipelineInput({
    topic: "시장 전망",
    title: "오늘 시장 전망",
    channel: "blog",
    runnerMode: "mock",
    referenceBundle,
    editorialBenchmarkGuidelines: ["사용자 주입 지침"],
    operationalRunKey: "public-cannot-set-this",
    operationalAttempt: 99,
  });

  assert.equal(result.referenceBundle, undefined);
  assert.equal(result.editorialBenchmarkGuidelines, undefined);
  assert.equal(result.operationalRunKey, undefined);
  assert.equal(result.operationalAttempt, undefined);
});

test("trusted scheduler input retains its already-collected reference bundle", () => {
  const referenceBundle = {
    provider: "naver-search",
    mode: "real",
    contentType: "KOREA_DAILY_PREVIEW",
    generatedAt: "2026-09-04T00:00:00.000Z",
    market: "KR",
    queries: ["코스피 전망"],
    items: [],
    keyThemes: ["외국인 수급"],
    repeatedKeywords: ["코스피"],
    differentiationPoints: ["전 영업일 데이터"],
    cautionNotes: [],
    sourcePolicy: "검증된 자료만 사용",
  };
  const input = {
    topic: "시장 전망",
    title: "오늘 시장 전망",
    channel: "blog",
    runnerMode: "mock",
    contentType: "KOREA_DAILY_PREVIEW",
    referenceBundle,
    blogImagePrompts: [{
      id: "market-chart",
      purpose: "section",
      placement: "2. 핵심 숫자",
      title: "시장 흐름",
      prompt: "시장 흐름 차트",
      negativePrompt: "왜곡 금지",
      notes: [],
    }],
    editorialBenchmarkGuidelines: ["검증 지침"],
    approvedLessonsByAgent: { "content-writer": [{
      lessonId: "lesson-1", fingerprint: "fp-1", title: "검증", instruction: "수치를 확인합니다.",
    }] },
    operationalRunKey: "morning:2026-09-04",
    operationalAttempt: 2,
  } as unknown as ContentPipelineInput;

  const result = assertTrustedContentPipelineInput(input);

  assert.equal(result.referenceBundle, referenceBundle);
  assert.equal(result.blogImagePrompts, input.blogImagePrompts);
  assert.equal(result.editorialBenchmarkGuidelines, input.editorialBenchmarkGuidelines);
  assert.equal(result.approvedLessonsByAgent, input.approvedLessonsByAgent);
  assert.equal(result.operationalRunKey, "morning:2026-09-04");
  assert.equal(result.operationalAttempt, 2);
});

test("trusted scheduler boundary rejects a malformed reference bundle", () => {
  assert.throws(() => assertTrustedContentPipelineInput({
    topic: "시장 전망",
    title: "오늘 시장 전망",
    channel: "blog",
    runnerMode: "hermes",
    contentType: "KOREA_DAILY_PREVIEW",
    referenceBundle: { provider: "naver-search" } as ContentPipelineInput["referenceBundle"],
  }), /trusted referenceBundle/);
});

test("trusted scheduler boundary rejects a bundle missing required arrays", () => {
  assert.throws(() => assertTrustedContentPipelineInput({
    topic: "시장 전망",
    title: "오늘 시장 전망",
    channel: "blog",
    runnerMode: "hermes",
    contentType: "KOREA_DAILY_PREVIEW",
    referenceBundle: {
      provider: "naver-search",
      mode: "real",
      contentType: "KOREA_DAILY_PREVIEW",
      generatedAt: "2026-09-04T00:00:00.000Z",
      market: "KR",
      items: [],
      sourcePolicy: "verified",
    } as unknown as ContentPipelineInput["referenceBundle"],
  }), /queries must be a string array/);
});

test("trusted scheduler boundary requires matching input and bundle content types", () => {
  const referenceBundle = {
    provider: "naver-search",
    mode: "real",
    contentType: "KOREA_DAILY_PREVIEW",
    generatedAt: "2026-09-04T00:00:00.000Z",
    market: "KR",
    queries: [],
    items: [],
    keyThemes: [],
    repeatedKeywords: [],
    differentiationPoints: [],
    cautionNotes: [],
    sourcePolicy: "verified",
  } as ContentPipelineInput["referenceBundle"];
  const base = {
    topic: "시장 전망",
    title: "오늘 시장 전망",
    channel: "blog" as const,
    runnerMode: "hermes" as const,
    referenceBundle,
  };

  assert.throws(() => assertTrustedContentPipelineInput(base), /contentType is required/);
  assert.throws(() => assertTrustedContentPipelineInput({
    ...base,
    contentType: "KOREA_MARKET_CLOSE_US_PREVIEW",
  }), /must match input contentType/);
});

test("trusted scheduler boundary rejects malformed auxiliary instructions", () => {
  assert.throws(() => assertTrustedContentPipelineInput({
    topic: "시장 전망",
    title: "오늘 시장 전망",
    channel: "blog",
    runnerMode: "hermes",
    contentType: "KOREA_DAILY_PREVIEW",
    blogImagePrompts: [{ purpose: "section" }] as ContentPipelineInput["blogImagePrompts"],
  }), /blogImagePrompts are invalid/);
});
