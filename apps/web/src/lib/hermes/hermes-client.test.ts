import assert from "node:assert/strict";
import test from "node:test";
import { buildContentWriterHermesPayload, buildQaAuditHermesPayload, normalizeQaAuditHermesResponse } from "./hermes-client.ts";

test("17시 미국장 전망 Writer는 독립 일정 문단을 만들지 않는다", () => {
  const payload = buildContentWriterHermesPayload({
    topic: "오늘 미국장 전망",
    title: "오늘 미국장 전망",
    channel: "blog",
    contentType: "KOREA_MARKET_CLOSE_US_PREVIEW",
  });

  assert.equal(payload.input.omitStandaloneScheduleSection, true);
});

test("아침 Writer는 국내장 관찰 시나리오를 한 문단에만 둔다", () => {
  const payload = buildContentWriterHermesPayload({
    topic: "오늘 코스피 전망",
    title: "오늘 코스피 전망",
    channel: "blog",
    contentType: "KOREA_DAILY_PREVIEW",
  });

  assert.match(payload.input.bodyStructure?.join("\n") ?? "", /시초가·개장 직후·오전·장중 유지력.*절대 쓰지 않음/);
  assert.match(payload.input.bodyStructure?.join("\n") ?? "", /한국투자증권 Open API 코스피 투자자별 매매동향 기준/);
  assert.match(payload.input.bodyStructure?.join("\n") ?? "", /마무리: 정확히 2문장/);
});

test("QA payload leaves source and ending structure to deterministic server checks", () => {
  const payload = buildQaAuditHermesPayload({
    topic: "오늘 시장",
    title: "오늘 시장에서 확인할 변수",
    channel: "blog",
    writerResult: { fullDraft: "검증 대상 본문" },
  });
  const diagnostics = payload.input.qualityGateDiagnostics ?? {};
  const responsibility = payload.input.qaResponsibility ?? {};

  assert.equal(Object.hasOwn(diagnostics, "requiredRealReferences"), false);
  assert.equal(Object.hasOwn(diagnostics, "requiredDistinctPublishers"), false);
  assert.equal(Object.hasOwn(diagnostics, "requiredCompetitorReferences"), false);
  assert.equal(Object.hasOwn(diagnostics, "requiredFredDegradedDisclosure"), false);
  assert.equal(Object.hasOwn(diagnostics, "requiredKisOverseasDegradedDisclosure"), false);
  assert.equal(responsibility.doNotAddServerStructuralChecksToRequiredRevisions, true);
  assert.deepEqual(responsibility.requiredRevisionScope, [
    "factual_accuracy",
    "unsupported_numeric_claims",
    "overstatement_or_investment_solicitation",
    "natural_korean_style",
  ]);
  assert.deepEqual(responsibility.deterministicServerChecks, [
    "source_count",
    "source_index_title_url_order",
    "source_section_total_url_count",
    "market_data_disclosure_order",
    "investment_disclaimer_position",
    "body_structure_counts",
  ]);
  assert.match(String(responsibility.instruction), /requiredRevisions에 넣지 말고/);
  assert.match(String(responsibility.instruction), /목록의 모든 기사를 본문에서 직접 언급하라고 요구하거나/);
});

test("QA 응답 정규화는 명시적인 빈 requiredRevisions 배열을 보존한다", () => {
  const normalized = normalizeQaAuditHermesResponse({
    qaScore: 98,
    publishReadiness: "ready",
    finalRecommendation: "approve",
    requiredRevisions: [],
  });
  assert.deepEqual(normalized.requiredRevisions, []);
});

test("QA가 승인·발행 가능을 명시하면 누락된 requiredRevisions를 빈 배열로 보완한다", () => {
  const normalized = normalizeQaAuditHermesResponse({
    qaScore: 97,
    publishReadiness: "ready",
    finalRecommendation: "approve",
  });
  assert.deepEqual(normalized.requiredRevisions, []);
  assert.deepEqual(normalizeQaAuditHermesResponse({
    qaScore: 97,
    publishReadiness: "ready",
    finalRecommendation: "approve",
    revisions: null,
  }).requiredRevisions, []);
});

test("QA 응답 정규화는 문자열이나 비문자 배열을 requiredRevisions로 인정하지 않는다", () => {
  const approval = { publishReadiness: "ready", finalRecommendation: "approve" };
  assert.equal(normalizeQaAuditHermesResponse({ ...approval, requiredRevisions: "없음" }).requiredRevisions, undefined);
  assert.equal(normalizeQaAuditHermesResponse({ ...approval, requiredRevisions: [123] }).requiredRevisions, undefined);
  assert.equal(normalizeQaAuditHermesResponse({ ...approval, requiredRevisions: [""] }).requiredRevisions, undefined);
});
