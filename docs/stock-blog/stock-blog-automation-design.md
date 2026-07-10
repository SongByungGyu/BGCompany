# Stock Blog Automation Design

## 현재 범위

BG Company는 콘텐츠 생성, 승인, 네이버 임시저장 준비까지 자동화한다. 네이버 블로그 발행은 사용자가 직접 수행한다.

## 목표 흐름

1. 스케줄이 콘텐츠 타입을 결정한다.
2. 주식 분석팀이 분석 리포트 구조를 준비한다.
3. Hermes 4-Agent가 원고를 생성/검토한다.
4. Director approval 후 Naver Draft Job이 생성된다.
5. Local Draft Agent가 사용자의 PC에서 네이버 글쓰기 화면에 임시저장을 준비한다.
6. 사용자가 최종 확인 후 발행한다.

## 하지 않는 것

- 네이버 자동 발행
- 네이버 로그인 cookie 서버 저장
- Playwright/Selenium 서버 자동 게시
- 실제 매수/매도/주문 API 연동

## 운영 원칙

자동화는 초안을 만들고 임시저장까지 돕는 역할이다. 투자 판단과 최종 발행 책임은 사용자에게 남긴다.
