import test from "node:test";
import assert from "node:assert/strict";

import { buildMultilineEditorInputSteps } from "./naver-writer.js";

function reconstruct(steps: ReturnType<typeof buildMultilineEditorInputSteps>) {
  return steps.map((step) => step.type === "enter" ? "\n" : step.value).join("");
}

test("여러 문단을 줄바꿈 없는 텍스트 조각과 Enter 단계로 분해한다", () => {
  const steps = buildMultilineEditorInputSteps("첫 번째 문단\r\n\r\n두 번째 문단\n세 번째 줄");

  assert.equal(reconstruct(steps), "첫 번째 문단\n\n두 번째 문단\n세 번째 줄");
  assert.equal(steps.filter((step) => step.type === "enter").length, 3);
  assert.ok(steps.filter((step) => step.type === "text").every((step) => !/[\r\n]/.test(step.value)));
});

test("빈 줄이 있어도 문단 간격을 Enter 횟수로 보존한다", () => {
  const steps = buildMultilineEditorInputSteps("A\n\nB");

  assert.deepEqual(steps, [
    { type: "text", value: "A" },
    { type: "enter" },
    { type: "enter" },
    { type: "text", value: "B" },
  ]);
});

test("비어 있는 본문은 입력 단계를 만들지 않는다", () => {
  assert.deepEqual(buildMultilineEditorInputSteps(" \n\n "), []);
});
