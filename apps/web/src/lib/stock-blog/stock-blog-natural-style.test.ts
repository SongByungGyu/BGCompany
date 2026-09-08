import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectNaturalStockBlogLayout,STOCK_BLOG_NATURAL_STYLE_GUIDELINES} from './stock-blog-natural-style.ts';
import {inspectStockBlogEditorialContract,getStockBlogEditorialGuidelines,BG_MARKET_NOTE_EDITORIAL_POLICY_VERSION} from './stock-blog-editorial-policy.ts';
import {assessStockBlogEditorialQuality,inspectOwnStockBlogStructure} from './stock-blog-editorial-benchmark.ts';

const body = [
  '외국인과 기관이 함께 매수했지만 지수는 내렸습니다. 당일 수급 합계와 종가가 다른 방향이라는 점에서, 누가 샀다는 사실만으로 강한 장이었다고 판단하기는 어렵습니다.',
  '지수가 돌아선 자리에서',
  '지수는 고점보다 217포인트 낮게 끝났습니다. 종가 등락률과 장중 변동의 차이는 투자자가 체감하는 위험을 설명합니다.',
  '반등을 확인할 다른 숫자',
  '금리가 진정된다면 업종별 상승 종목 수도 비교하겠습니다. 몇 종목만 오른 경우에는 시장 전체의 반등이라는 해석을 미뤄야 한다고 봅니다.',
  '마무리',
  '확인할 항목은 금리 수준과 업종별 확산입니다.',
  '함께 확인한 기사',
  '1. 테스트 출처\n- 원문: https://example.com/test',
].join('\n\n');

test('내용형 소제목과 서술형 판단은 고정 번호 없이 인식한다',()=>{
  const layout=inspectNaturalStockBlogLayout(body);
  assert.equal(layout.active,true);
  assert.equal(layout.headingCount,2);
  assert.equal(layout.hasJudgment,true);
  assert.deepEqual(inspectStockBlogEditorialContract(body,'KOREA_MARKET_CLOSE_US_PREVIEW').violations,[]);
});
test('옛 형식은 누락된 요약을 새 형식으로 오인하지 않는다',()=>{
  assert.equal(inspectNaturalStockBlogLayout('3. 오늘 핵심 변수 2가지\n\n변수 1: 금리\n\n7. BG Market Note 판단').active,false);
});
test('빈 글과 금지 표현은 새 문체에서도 반려한다',()=>{
  assert.ok(inspectStockBlogEditorialContract('', 'KOREA_DAILY_PREVIEW').violations.length>=4);
  assert.ok(inspectStockBlogEditorialContract(`${body}\n수익 보장`, 'KOREA_DAILY_PREVIEW').violations.some(v=>v.includes('금지 표현')));
});
test('새 문체가 QA 점수나 출처 요건을 대체하지 않는다',()=>{
  const structure=inspectOwnStockBlogStructure({title:'검토용',body,contentType:'KOREA_DAILY_PREVIEW',imageCount:3});
  const assessment=assessStockBlogEditorialQuality({structure,contentType:'KOREA_DAILY_PREVIEW',realReferenceCount:0,publisherCount:0,verifiedMarketSnapshot:false,qaScore:94});
  assert.equal(assessment.passed,false);
  assert.equal(assessment.target,95);
  assert.ok(assessment.failedChecks.some(v=>v.includes('QA 95')));
});
test('작성 지침에 승인 문체와 출처 줄간격 규칙을 항상 제공한다',()=>{
  assert.equal(BG_MARKET_NOTE_EDITORIAL_POLICY_VERSION,8);
  assert.match(STOCK_BLOG_NATURAL_STYLE_GUIDELINES.join('\n'),/빈 줄 없이 한 줄씩/);
  assert.match(getStockBlogEditorialGuidelines('INVESTMENT_STUDY').join('\n'),/없는 종목별 사례/);
});
