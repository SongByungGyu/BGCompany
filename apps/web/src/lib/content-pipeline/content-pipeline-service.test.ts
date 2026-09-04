import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { asExplicitRequiredRevisions, restoreQaRequiredRevisions } from "./content-pipeline-service.ts";

test("public and trusted pipeline entry points use separate input boundaries", () => {
  const source = fs.readFileSync(new URL("./content-pipeline-service.ts", import.meta.url), "utf8");

  assert.match(source, /startValidatedContentPipeline\(assertPublicContentPipelineInput\(input\)\)/);
  assert.match(source, /startValidatedContentPipeline\(assertTrustedContentPipelineInput\(input\)\)/);
});

test("파이프라인 복원은 QA의 명시적인 빈 수정 목록을 보존한다", () => {
  assert.deepEqual(asExplicitRequiredRevisions([]), []);
  assert.deepEqual(asExplicitRequiredRevisions(["수치 근거를 보강하세요."]), ["수치 근거를 보강하세요."]);
  assert.equal(asExplicitRequiredRevisions(undefined), undefined);
  assert.equal(asExplicitRequiredRevisions([123]), undefined);
  assert.equal(asExplicitRequiredRevisions([""]), undefined);
});

test("과거 저장본은 고득점 승인이고 키가 없을 때만 빈 수정 목록을 복원한다", () => {
  const approved = { ok: true, qaScore: 98, publishReadiness: "ready", finalRecommendation: "approve" };
  assert.deepEqual(restoreQaRequiredRevisions(approved), []);
  assert.equal(restoreQaRequiredRevisions({ ...approved, qaScore: 94 }), undefined);
  assert.equal(restoreQaRequiredRevisions({ ...approved, requiredRevisions: "없음" }), undefined);
  assert.equal(restoreQaRequiredRevisions({ ...approved, finalRecommendation: "revise" }), undefined);
});
