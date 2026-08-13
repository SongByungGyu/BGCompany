# Stock Content Policy

BG Market Note content is a market briefing and study aid. It is not investment advice.

## Required disclaimer

> 본 글은 투자 판단을 돕기 위한 시장 정리 자료이며, 특정 종목의 매수·매도 추천이 아닙니다. 투자 결정과 책임은 투자자 본인에게 있습니다.

The disclaimer must be present in:

- pasteReadyBody
- markdownBody
- htmlBody
- disclaimer field

## Writing principles

- Separate facts, interpretation, and opinion.
- Avoid direct buy/sell instructions.
- Do not promise returns.
- Do not imply certainty such as “무조건”, “확정”, or “보장”.
- If numerical market data is used later, include source and timestamp.
- In Phase 1-C, live market data is not connected, so the system must not invent exact index values.
- 공개 글은 자연스러운 한국어 설명체로 쓴다. 검색 질문에 바로 답하고 `이번 글에서는`, `살펴보겠습니다`, `알아보겠습니다` 같은 예고 문장을 쓰지 않는다.
- `이는 ○○를 시사합니다`, `투자자들은 주목해야 합니다`, `○○로 이어질 것으로 예상됩니다` 같은 번역투·AI 보고서 문장을 쓰지 않는다.
- 명사를 길게 나열하지 말고 주어와 서술어가 분명한 짧은 문장으로 바꾼다. 같은 문장 시작과 `~합니다` 어미를 연속해서 반복하지 않는다.

## Forbidden expressions

- 매수 추천
- 매도 추천
- 수익 보장
- 급등 확정
- 무조건 오른다
- 지금 사면 오른다
- 몰빵 기회
- 대박 공개

## Tags

Keep tags practical and limited to around 8-12 items.

Common tags:

- BGMarketNote
- 주식시장
- 증시브리핑
- 시장전망
- 투자공부

Korea-market candidates:

- 한국주식
- 코스피
- 코스닥
- 국장전망
- 국장마감
- 환율
- 반도체
- 2차전지

US-market candidates:

- 미국주식
- 나스닥
- S&P500
- 다우지수
- 미장전망
- 빅테크
- 금리
- 달러

Weekly candidates:

- 주간증시
- 시장정리
- 섹터흐름
- 다음주증시
- 경제지표

## Thumbnail and image rules

- Do not use company logos.
- Do not use copyrighted news images or screenshots.
- Do not invent real index values or returns.
- Prefer abstract charts, calendars, memo cards, checklists, and market briefing cards.
- Keep enough blank space for text overlays.

## Automation boundaries

The following are prohibited in the current phase:

- real stock API calls
- Naver auto login
- Naver auto save or publish
- Playwright/Selenium publishing
- WordPress REST publishing
- trading/order API integration

## Phase 1-S.5 참고자료 사용 원칙

주식시장 브리핑은 참고자료를 기사 원문 대체물이 아니라 방향성 점검용으로만 사용합니다.

- 기사 전문 복사 금지
- 출처 링크 유지
- 서로 다른 관점의 키워드 확인
- 투자 권유 표현 금지
- 미확인 지수/수치 단정 금지
- 자동 게시 전 사람 검토 유지
