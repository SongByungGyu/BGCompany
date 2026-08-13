# Stock Blog Team Operations

BG Company의 주식 블로그 운영은 네이버 블로그 수동 발행을 전제로, 콘텐츠 생성부터 임시저장 준비까지를 팀 단위로 분리한다.

## 팀 구성

### 주식 분석팀

- 담당: 시장 브리핑 주제 확정, 지수/섹터/리스크 체크리스트 구성
- 현재 단계: mock/reference 기반 분석 보고서 생성
- 향후 단계: 실제 주식/뉴스 API 연결 후 출처 기반 분석

### 블로그 운영팀

- 담당: content-planner, marketing-manager, content-writer 결과를 네이버 블로그용 원고로 정리
- 산출물: 제목, 본문, Markdown, HTML, 태그, 썸네일 문구, 이미지 프롬프트

### QA/감사팀

- 담당: 과장 표현, 투자 권유성 문구, 누락 섹션, 면책 문구 점검
- 산출물: QA 결과, 수정 권고, 승인 전 체크리스트

### 게시 운영팀

- 담당: 승인 완료 콘텐츠를 Naver Draft Job Queue에 등록하고 Local Draft Agent로 임시저장 준비
- 원칙: 자동 발행 금지, 사용자가 최종 발행

## 기본 스케줄

| 시간 | 콘텐츠 타입 | 목적 |
|---|---|---|
| 평일 07:20 KST 생성 시작·08:20 이전 발행 | KOREA_DAILY_PREVIEW | 금일 한국장 전망 |
| 화·목 12:10 KST | INVESTMENT_STUDY | 당일 시장 이슈 우선 투자 공부, 조용한 날은 검색형 기초 개념 |
| 월·수·금 12:10 KST 조건부 | INVESTMENT_STUDY | 이슈 점수 통과 시 주 1회만 추가 발행 |
| 평일 17:00 KST | KOREA_MARKET_CLOSE_US_PREVIEW | 한국장 마감 + 미국장 프리뷰 |
| 토요일 09:00 KST | WEEKLY_MARKET_REVIEW | 한국·미국 주간 시장 정리 |
| 일요일 19:00 KST | NEXT_WEEK_MARKET_PREVIEW | 다음 주 시장 프리뷰 |

## Hermes 사용 원칙

- 4-Agent 기준 최대 4회 호출: planner, marketing, writer, qa
- 기본 일일 한도 제안: 20회
- 실제 실행은 사용량 가드레일과 비용 경고를 통과해야 한다.
