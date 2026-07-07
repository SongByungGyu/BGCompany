# Naver Blog Publish Prep

BG Company Phase 1-C.15에서는 콘텐츠 파이프라인 승인 결과를 네이버 블로그 수동 업로드용 결과물로 정리한다.

## 범위

- 네이버 블로그 자동 로그인, 자동 업로드, 자동 발행은 하지 않는다.
- 승인 완료된 콘텐츠를 복사 가능한 형태로 정리한다.
- 제목, 본문, Markdown, HTML, 태그, 썸네일 문구, 이미지 프롬프트, 투자 유의문구를 제공한다.
- 게시 URL 저장은 1차에서는 화면 상태로만 제공하며 DB 저장은 추후 단계에서 다룬다.

## 생성 기준

게시 준비 데이터는 DB schema 변경 없이 pipeline detail의 기존 결과에서 파생한다.

1. 제목: writerResult.finalTitle → marketingResult.recommendedTitle → plannerResult.title → pipeline title
2. 본문: writerResult.fullDraft/markdownDraft → plannerResult.content → pipeline summary
3. 태그: writerResult.usedSeoKeywords → marketingResult.seoKeywords → plannerResult.seoKeywords → 기본 태그
4. 카테고리: 주제/제목을 기반으로 주식 브리핑 템플릿을 추론해 추천한다.

## 수동 게시 체크리스트

- 네이버 블로그 제목 붙여넣기
- 본문 붙여넣기
- 태그 입력
- 카테고리 선택
- 썸네일 이미지 업로드
- 투자 유의문구 확인
- 미리보기 확인
- 임시저장 또는 발행 직접 진행
- 게시 URL 기록

## 금지 사항

- 네이버 로그인 cookie 우회
- Playwright/Selenium을 이용한 게시 자동화
- 실제 주식 주문/매매 API 연동
- 투자 수익 보장 표현
- 실제 지수 수치 자동 생성
