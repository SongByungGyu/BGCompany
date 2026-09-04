import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { asExplicitRequiredRevisions } from "./content-pipeline-service.ts";

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
