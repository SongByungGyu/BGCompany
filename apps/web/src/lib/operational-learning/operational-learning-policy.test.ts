import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyOperationalFailure,
  operationalLessonVerificationErrors,
  recentOccurrenceCount,
  selectApplicableLessonInstructions,
  shouldCreateImprovementProposal,
} from "./operational-learning-policy.ts";

test("시장 데이터 preflight 실패를 안정적인 fingerprint로 분류한다", () => {
  const first = classifyOperationalFailure({
    sourceEventId: "event-1",
    summary: "scheduler failed",
    payload: {
      scheduleKey: "daily:2026-08-14",
      attempt: 1,
      reason: "STOCK_REFERENCE_PREFLIGHT_BLOCKED: needs_credentials · key missing",
    },
  });
  const second = classifyOperationalFailure({
    sourceEventId: "event-2",
    summary: "scheduler failed again",
    payload: {
      scheduleKey: "daily:2026-08-14",
      attempt: 2,
      reason: "STOCK_REFERENCE_PREFLIGHT_BLOCKED: needs_data · snapshot missing",
    },
  });

  assert.equal(first.fingerprint, "stock-blog:reference-preflight:missing-verified-market-data");
  assert.equal(first.fingerprint, second.fingerprint);
  assert.notEqual(first.occurrenceKey, second.occurrenceKey);
  assert.equal(first.ownerAgentId, "stock-monitor");
});

test("같은 실행의 중복 이벤트는 같은 occurrenceKey를 사용한다", () => {
  const input = {
    employeeId: "qa-auditor",
    payload: {
      contentPipelineId: "content-pipeline-123",
      errorCode: "STOCK_CONTENT_QUALITY_FAILED",
      message: "품질 게이트 차단: 본문 길이 부족",
    },
  };
  const first = classifyOperationalFailure({ ...input, sourceEventId: "event-a" });
  const second = classifyOperationalFailure({ ...input, sourceEventId: "event-b" });
  assert.equal(first.occurrenceKey, second.occurrenceKey);
  assert.equal(first.fingerprint, "stock-blog:quality-gate:editorial-quality-gate-blocked");
});

test("7일 안의 두 번째 발생에서 개선 제안을 만든다", () => {
  const now = new Date("2026-08-14T00:00:00Z");
  const recent = [new Date("2026-08-10T00:00:00Z"), new Date("2026-08-14T00:00:00Z")];
  assert.equal(recentOccurrenceCount(recent, now), 2);
  assert.equal(shouldCreateImprovementProposal(recent, now), true);
  assert.equal(shouldCreateImprovementProposal([new Date("2026-08-01T00:00:00Z"), recent[1]], now), false);
});

test("verified 전환에는 승인, 예방 규칙, 회귀 검증, 증거가 모두 필요하다", () => {
  assert.deepEqual(operationalLessonVerificationErrors({
    approvalStatus: "approved",
    preventionRule: "같은 실패를 차단한다.",
    regressionTest: "test:learning",
    verificationEvidence: "3회 연속 통과",
  }), []);
  assert.equal(operationalLessonVerificationErrors({ approvalStatus: "pending" }).length, 4);
});

test("승인되고 예방 상태인 관련 교훈만 Agent에 전달한다", () => {
  const now = new Date("2026-08-14T00:00:00Z");
  const lessons = [
    { id: "1", fingerprint: "a:b:c", title: "approved", area: "stock-blog", agentId: "content-writer", status: "prevented", approvalStatus: "approved", preventionRule: "본문 길이를 검사한다.", policyVersion: "v1", updatedAt: now },
    { id: "2", fingerprint: "a:b:d", title: "pending", area: "stock-blog", agentId: "content-writer", status: "contained", approvalStatus: "pending", preventionRule: "적용하면 안 됨", policyVersion: null, updatedAt: now },
    { id: "3", fingerprint: "a:b:e", title: "other agent", area: "stock-blog", agentId: "qa-auditor", status: "verified", approvalStatus: "approved", preventionRule: "QA 규칙", policyVersion: null, updatedAt: now },
  ];
  const selected = selectApplicableLessonInstructions(lessons, { agentId: "content-writer", area: "stock-blog" });
  assert.deepEqual(selected.map((item) => item.lessonId), ["1"]);
});
