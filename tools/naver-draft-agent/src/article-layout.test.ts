import test from "node:test";
import assert from "node:assert/strict";
import { buildNaverArticleLayout } from "./article-layout.js";

test("기사 제목 링크는 빈 문단 없이 연속 배치하고 본문·면책은 보존", () => {
  const body = "본문 첫 문단.\n\n둘째 문단.\n\n함께 확인한 기사\n\n1. 첫 기사\n- 출처: AP\n- 발행일: 2026-09-08\n- 원문: https://example.com/one\n\n2. 둘째 기사\n- 원문: https://example.com/two\n\n본 글은 시장 정보입니다.";
  const result = buildNaverArticleLayout(body);
  assert.equal(result.body, "본문 첫 문단.\n\n둘째 문단.\n\n함께 확인한 기사\nAP | 첫 기사\n둘째 기사\n\n본 글은 시장 정보입니다.");
  assert.deepEqual(result.links, [{title:"AP | 첫 기사",url:"https://example.com/one"},{title:"둘째 기사",url:"https://example.com/two"}]);
});

test("Markdown 제목 링크와 달러 기호를 그대로 보존", () => {
  const result = buildNaverArticleLayout("참고한 기사와 자료\n\n[AP | Oil $98](https://example.com/oil)\n\n[BLS 일정](https://example.com/bls)\n\n본 글은 참고 자료입니다.");
  assert.equal(result.body, "참고한 기사와 자료\nAP | Oil $98\nBLS 일정\n\n본 글은 참고 자료입니다.");
  assert.equal(result.links.length, 2);
});

test("제목 또는 URL이 없으면 원문 보기로 대체해 발행하지 않음", () => {
  assert.throws(()=>buildNaverArticleLayout("함께 확인한 기사\nhttps://example.com"), /TITLE_MISSING/);
  assert.throws(()=>buildNaverArticleLayout("함께 확인한 기사\n제목만 있음"), /URL_MISSING/);
});

test("출처 밖 URL과 문단 간격은 바꾸지 않음", () => {
  const body="첫 문단\n\nhttps://example.com\n\n둘째 문단";
  assert.equal(buildNaverArticleLayout(body).body,body);
});

test("데이터 누락 고지문은 기사로 오인하지 않고 원문 그대로 유지", () => {
  const disclosures = [
    "미국 금리와 경제지표는 확인 가능한 최신 공식 수치만 반영했습니다.",
    "FRED 거시지표 조회 지연으로 미국 국채금리 또는 경제지표 일정 일부를 이번 브리핑에서 제외했습니다.",
    "KIS 업종 등락 자료가 일시적으로 비어 있어 강세·약세 업종 항목은 제외하고, 검증된 지수·수급·환율·거시자료만 사용했습니다.",
    "※ 확인되지 않은 해외지수·환율 수치와 관련 그래프는 제외하고, 검증된 국내 지수·수급·미국 금리 자료만 사용했습니다.",
  ];
  for (const disclosure of disclosures) {
    const result = buildNaverArticleLayout(`함께 확인한 기사\n\n1. 미국 국채금리 동향\n- 원문: https://example.com/rates\n\n${disclosure}\n\n본 글은 투자 참고 자료입니다.`);
    assert.equal(result.links.length, 1);
    assert.ok(result.body.endsWith(`${disclosure}\n\n본 글은 투자 참고 자료입니다.`));
  }
});
