# Stock Briefing Templates

BG Company Phase 1-C.16 uses four stock-market briefing templates for Naver Blog manual publishing.

The templates are deterministic preparation rules. They do not fetch live market data, do not call a stock API, and do not publish automatically.

## 1. KOREA_DAILY_PREVIEW

- Schedule: every day at 08:30 KST
- Recommended writing window: 08:00-08:20 KST
- Purpose: today's Korean stock market status and outlook
- Recommended Naver category: 오늘의 한국장 전망

Required sections:

- 오늘의 한국장 한 줄 요약
- 전일 미국장 흐름
- 환율/금리/유가 체크
- 오늘의 주요 변수
- 코스피·코스닥 예상 흐름
- 주목 섹터
- 리스크 요인
- 투자자 체크리스트
- 투자 유의문구

Default tags:

- BGMarketNote
- 주식시장
- 증시브리핑
- 시장전망
- 투자공부
- 한국주식
- 코스피
- 코스닥
- 국장전망
- 환율
- 반도체
- 2차전지

## 2. KOREA_MARKET_CLOSE_US_PREVIEW

- Schedule: every day at 17:00 KST
- Recommended writing window: 15:45-16:20 KST
- Purpose: Korea market close review and US market preview
- Recommended Naver category: 오늘의 미국장 전망

Required sections:

- 오늘의 한국장 마감 요약
- 코스피·코스닥 흐름
- 수급 체크
- 강세/약세 섹터
- 환율/금리/유가 체크
- 미국 선물 흐름
- 오늘 밤 미장 체크포인트
- 리스크 요인
- 투자자 체크리스트
- 투자 유의문구

Default tags:

- BGMarketNote
- 주식시장
- 증시브리핑
- 시장전망
- 투자공부
- 미국주식
- 나스닥
- S&P500
- 다우지수
- 미장전망
- 빅테크
- 금리

## 3. WEEKLY_MARKET_REVIEW

- Schedule: Friday 16:00 KST or Saturday morning
- Purpose: weekly Korea/US stock-market review
- Recommended Naver category: 주간 시장 정리

Required sections:

- 이번 주 시장 한 줄 요약
- 코스피·코스닥 흐름
- S&P500·나스닥 흐름
- 주요 상승/하락 섹터
- 주요 뉴스/이벤트
- 다음 주로 이어질 포인트
- 리스크 요인
- 투자자 체크리스트
- 투자 유의문구

Default tags:

- BGMarketNote
- 주식시장
- 증시브리핑
- 투자공부
- 주간증시
- 시장정리
- 섹터흐름
- 다음주증시
- 경제지표
- 한국주식
- 미국주식

## 4. NEXT_WEEK_MARKET_PREVIEW

- Schedule: weekend or Sunday
- Purpose: next week market preview
- Recommended Naver category: 주요 이슈/섹터

Required sections:

- 다음 주 시장 한 줄 요약
- 다음 주 경제지표
- 기업 실적 일정
- FOMC/CPI/고용지표 등 주요 이벤트
- 관심 섹터
- 리스크 시나리오
- 투자자 체크리스트
- 투자 유의문구

Default tags:

- BGMarketNote
- 주식시장
- 증시브리핑
- 시장전망
- 투자공부
- 다음주증시
- 경제지표
- 실적시즌
- 금리
- 섹터흐름

## Title policy

Good titles should be click-worthy but not sensational.

Allowed examples:

- 오늘의 한국장 체크포인트: 반도체 수급과 환율 흐름 주목
- 미국장 프리뷰: 금리와 빅테크 실적이 만드는 오늘 밤 변수
- 이번 주 증시 정리: 반도체·2차전지·환율 흐름 한눈에 보기
- 다음 주 증시 일정: CPI·실적·금리 이벤트 체크

Forbidden title patterns:

- 무조건 오른다
- 급등 확정
- 지금 사면 오른다
- 수익 보장
- 몰빵 기회
- 대박 공개
- 매수 추천
- 매도 추천

## Thumbnail and image prompt policy

Thumbnail copy should be short and neutral.

Recommended thumbnail copy:

- 오늘의 한국장 체크
- 미국장 프리뷰
- 주간 시장 정리
- 다음 주 증시 일정
- 금리·환율 체크
- 반도체 수급 점검

Image prompts should follow these constraints:

- soft navy or cream background
- premium finance report style
- candle chart or line chart motifs
- Korea/US market briefing mood
- no company logos
- no real index numbers
- no exaggerated profit expression
- leave clean text-safe whitespace

## Disclaimer

Every final output must include:

> 본 글은 투자 판단을 돕기 위한 시장 정리 자료이며, 특정 종목의 매수·매도 추천이 아닙니다. 투자 결정과 책임은 투자자 본인에게 있습니다.

The disclaimer must be included in:

- pasteReadyBody
- markdownBody
- htmlBody
- disclaimer field

## Automation boundaries

The current phase does not perform:

- real stock API calls
- real-time market data fetching
- Hermes auto execution without user action
- Naver auto login
- Naver auto draft/save/publish
- Playwright or Selenium publishing
- WordPress REST API publishing
- trading or order API calls
