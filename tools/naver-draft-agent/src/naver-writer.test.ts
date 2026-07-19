import test from "node:test";
import assert from "node:assert/strict";

import {
  buildMultilineEditorInputSteps,
  hasSavedDraftTitle,
  pickMostReadableEditorText,
  savedDraftTitleMatchToken,
  selectNaverSectionHeadings,
} from "./naver-writer.js";

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

test("본문 1~6절과 기사·마무리만 네이버 소제목으로 선택한다", () => {
  const headings = selectNaverSectionHeadings(`도입부

1. 지난주 시장은 어땠을까
본문

2. 다음 주 한국 증시 전망
본문

함께 확인한 기사
1. 첫 번째 기사 – 언론사, 2026년 7월 19일
https://example.com/one
2. 두 번째 기사 – 언론사, 2026년 7월 18일
https://example.com/two

마무리
결론`);

  assert.deepEqual(headings, [
    "1. 지난주 시장은 어땠을까",
    "2. 다음 주 한국 증시 전망",
    "함께 확인한 기사",
    "마무리",
  ]);
});

test("여러 프레임과 selector 후보 중 가장 긴 본문을 선택한다", () => {
  const selected = pickMostReadableEditorText([
    "본문",
    "첫 문단",
    "첫 문단\n둘째 문단\n셋째 문단",
    "숨은 짧은 요소",
  ]);

  assert.equal(selected, "첫 문단\n둘째 문단\n셋째 문단");
});

test("글자 수가 같으면 줄과 문단 구조가 더 풍부한 후보를 선택한다", () => {
  const selected = pickMostReadableEditorText(["가나다라마바", "가나\n다라\n마바"]);

  assert.equal(selected, "가나\n다라\n마바");
});

test("임시저장 목록의 말줄임 표시 전 제목 접두어로 저장 성공을 확인한다", () => {
  const title = "7/19 다음 주 증시 전망 2026년 7월 20~24일 한국 미국 주식시장 전망…";
  const listText = "임시저장 글\n7/19 다음 주 증시 전망 2026년 7월 20~24일 한국 미국 주식시장 전...\n2026.07.19";

  assert.equal(savedDraftTitleMatchToken(title), "7/19 다음 주 증시 전망 2026년 7월 20~24일");
  assert.equal(hasSavedDraftTitle(listText, title), true);
  assert.equal(hasSavedDraftTitle("임시저장 글\n다른 제목", title), false);
});
