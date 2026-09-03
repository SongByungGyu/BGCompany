import test from "node:test";
import assert from "node:assert/strict";
import { isNvidiaEarningsSubject, isUsMarketStudySubject } from "./stock-blog-image-generator";

test("엔비디아가 시장 복기 사례로만 언급되면 실적 전용 이미지로 분류하지 않는다", () => {
  assert.equal(isNvidiaEarningsSubject({
    title: "나스닥 반등 이유와 미국 10년물 금리 숨고르기",
    topic: "국채금리 진정 뒤 엔비디아와 델 등 대표 기술주의 반응을 복기한다.",
  }), false);
});

test("엔비디아 실적·매출·가이던스 분석은 실적 전용 이미지로 분류한다", () => {
  assert.equal(isNvidiaEarningsSubject({
    title: "엔비디아 실적 발표 뒤 시간외 주가는 왜 올랐을까",
    topic: "분기 매출과 EPS, 다음 분기 가이던스를 공식 자료로 분석한다.",
  }), true);
});

test("미국증시·나스닥 복기 글은 미국시장 중심 이미지 대상으로 분류한다", () => {
  assert.equal(isUsMarketStudySubject({
    title: "나스닥 반등 이유와 미국 10년물 금리 숨고르기, 미국증시 복기",
    topic: "9월 2일 뉴욕증시를 금리와 기술주 흐름으로 정리한다.",
  }), true);
});

test("국내 수급 공부 글은 미국시장 중심 이미지 대상으로 분류하지 않는다", () => {
  assert.equal(isUsMarketStudySubject({
    title: "외국인 수급은 왜 코스피와 다르게 보였나",
    topic: "현물·선물·업종 확산으로 국내 수급을 공부한다.",
  }), false);
});
