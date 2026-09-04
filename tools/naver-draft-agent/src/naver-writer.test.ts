import test from "node:test";
import assert from "node:assert/strict";

import {
  buildNaverImageCaption,
  buildMultilineEditorInputSteps,
  hasSavedDraftTitle,
  normalizeNaverCategoryLabel,
  normalizeNaverTags,
  isPublishedNaverUrl,
  parsePublishedNaverUrl,
  pickMostReadableEditorText,
  prepareNaverPublicationBody,
  resolveNaverPublishCategory,
  savedDraftTitleMatchToken,
  selectNaverArticleUrls,
  selectNaverEmphasisParagraphs,
  selectNaverSectionHeadings,
  waitForVerificationClear,
} from "./naver-writer.js";

test("네이버 공개 성공은 대상 블로그의 숫자형 게시글 URL만 인정한다", () => {
  const writeUrl = "https://blog.naver.com/PostWriteForm.naver";
  const postId = "223123456789";
  for (const url of [
    `https://blog.naver.com/bgmarketnote/${postId}`,
    `https://m.blog.naver.com/bgmarketnote/${postId}?from=postView#anchor`,
    `https://blog.naver.com/PostView.naver?blogId=bgmarketnote&logNo=${postId}`,
  ]) {
    assert.equal(isPublishedNaverUrl(url, writeUrl, "bgmarketnote"), true, url);
    assert.equal(parsePublishedNaverUrl(url, "bgmarketnote")?.postId, postId);
  }
  for (const url of [
    "https://blog.naver.com/",
    "https://blog.naver.com/PostList.naver?blogId=bgmarketnote",
    "https://blog.naver.com/PostWriteForm.naver?blogId=bgmarketnote",
    `https://blog.naver.com/otherblog/${postId}`,
    "https://blog.naver.com/bgmarketnote/not-a-number",
    `https://example.com/bgmarketnote/${postId}`,
  ]) {
    assert.equal(isPublishedNaverUrl(url, writeUrl, "bgmarketnote"), false, url);
  }
});

test("본문 이미지 설명과 출처를 네이버 기본 캡션 한 문단으로 합친다", () => {
  assert.equal(
    buildNaverImageCaption("원·달러 환율과 미국 국채금리 비교", "기준일 2026. 08. 14. | 출처 KIS · FRED"),
    "원·달러 환율과 미국 국채금리 비교 · 기준일 2026. 08. 14. | 출처 KIS · FRED",
  );
  assert.equal(buildNaverImageCaption("이미지 설명", "출처", false), "이미지 설명");
});

test("네이버 태그는 공백과 구두점을 제거하고 중복 없이 정규화한다", () => {
  assert.deepEqual(normalizeNaverTags([
    "오늘 코스피 마감 원인",
    "#KOSPI 외국인 순매수",
    "기계·장비 강세",
    "오늘 코스피 마감 원인",
  ]), [
    "오늘코스피마감원인",
    "KOSPI외국인순매수",
    "기계장비강세",
  ]);
});

test("네이버 하위 카테고리 표시 문구를 실제 카테고리명으로 정규화한다", () => {
  assert.equal(normalizeNaverCategoryLabel("하위 카테고리 투자 공부"), "투자공부");
  assert.equal(normalizeNaverCategoryLabel("투자 공부"), "투자공부");
});

test("기존 논리 카테고리를 예약 시간별 네이버 실제 카테고리로 변환한다", () => {
  assert.equal(resolveNaverPublishCategory("주식시장 브리핑", "07:20"), "오늘의 한국장 전망");
  assert.equal(resolveNaverPublishCategory("주식시장 브리핑", "17:00"), "오늘의 미국장 전망");
  assert.equal(resolveNaverPublishCategory("주식시장 브리핑", "09:00"), "주간 시장 정리");
  assert.equal(resolveNaverPublishCategory("주식시장 브리핑", "19:00"), "차주 시장 전망");
  assert.equal(resolveNaverPublishCategory("투자 공부", "17:00"), "투자 공부");
});

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

test("네이버 발행 본문은 번호 제목 간격과 원문 URL만 안전하게 바꾼다", () => {
  const body = `4. 다음 주 핵심 일정
본문

5. 이번 주에 눈여겨볼 기회와 위험
기회 요인
본문
위험 요인
본문

함께 확인한 기사
1. 기사 제목 – 언론사, 2026년 7월 19일
https://example.com/one`;
  const prepared = prepareNaverPublicationBody(body);

  assert.ok(prepared.includes("5.\u00a0이번 주에 눈여겨볼 기회와 위험"));
  assert.ok(prepared.includes("원문 보기"));
  assert.ok(!prepared.includes("https://example.com/one"));
  assert.deepEqual(selectNaverArticleUrls(body), ["https://example.com/one"]);
  assert.deepEqual(selectNaverEmphasisParagraphs(prepared), ["기회 요인", "위험 요인"]);
  assert.deepEqual(selectNaverSectionHeadings(prepared), [
    "4. 다음 주 핵심 일정",
    "5. 이번 주에 눈여겨볼 기회와 위험",
    "함께 확인한 기사",
  ]);
});

test("공백만 있는 문단과 연속 빈 줄은 한 번의 문단 간격으로 정리한다", () => {
  const prepared = prepareNaverPublicationBody("첫 문단\n \n\n\n둘째 문단");

  assert.equal(prepared, "첫 문단\n\n둘째 문단");
});

test("검수 과정처럼 보이는 일정 문장은 독자용 문장으로 바꾼다", () => {
  const prepared = prepareNaverPublicationBody(
    "확인되지 않은 국내 일정은 별도로 넣지 않았습니다. 새 일정은 날짜와 공식 내용을 확인한 뒤 시장 반응을 판단할 필요가 있습니다.",
  );

  assert.equal(prepared, "추가 일정은 공식 발표 여부를 확인한 뒤 시장 반응과 함께 살펴볼 필요가 있습니다.");
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

test("네이버 로그인이 풀리면 두 번 연속 확인 후 자동으로 재개한다", async () => {
  let now = 0;
  let inspections = 0;
  const blockedStates = [true, false, false];
  const resumed = await waitForVerificationClear({
    inspectBlocked: async () => blockedStates[inspections++] ?? false,
    wait: async (milliseconds) => { now += milliseconds; },
    now: () => now,
    timeoutMs: 10_000,
    pollMs: 1_000,
  });

  assert.equal(resumed, true);
  assert.equal(inspections, 3);
});

test("일시적으로 로그인 문구가 사라져도 한 번만으로 재개하지 않는다", async () => {
  let now = 0;
  let inspections = 0;
  const blockedStates = [false, true, false, false];
  const resumed = await waitForVerificationClear({
    inspectBlocked: async () => blockedStates[inspections++] ?? false,
    wait: async (milliseconds) => { now += milliseconds; },
    now: () => now,
    timeoutMs: 10_000,
    pollMs: 1_000,
  });

  assert.equal(resumed, true);
  assert.equal(inspections, 4);
});

test("인증 대기 중 heartbeat를 보내고 제한 시간이 지나면 안전하게 끝낸다", async () => {
  let now = 0;
  let heartbeats = 0;
  const resumed = await waitForVerificationClear({
    inspectBlocked: async () => true,
    wait: async (milliseconds) => { now += milliseconds; },
    heartbeat: async () => { heartbeats += 1; },
    now: () => now,
    timeoutMs: 3_500,
    pollMs: 500,
    heartbeatMs: 1_000,
  });

  assert.equal(resumed, false);
  assert.equal(heartbeats, 3);
  assert.equal(now, 3_500);
});

test("인증 창이 닫히면 추가 대기 없이 안전하게 끝낸다", async () => {
  let waited = false;
  const resumed = await waitForVerificationClear({
    inspectBlocked: async () => true,
    wait: async () => { waited = true; },
    isClosed: () => true,
    timeoutMs: 10_000,
  });

  assert.equal(resumed, false);
  assert.equal(waited, false);
});
