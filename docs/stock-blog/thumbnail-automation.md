# Stock Blog Thumbnail Automation

BG Company의 주식시장 브리핑 콘텐츠는 네이버 블로그 수동 발행을 전제로 썸네일 문구와 이미지 생성 프롬프트를 자동 준비한다.

## 범위

- 콘텐츠 파이프라인 결과에서 썸네일 제목, 보조 문구, 훅, 스타일, 프롬프트를 파생한다.
- 실제 이미지 생성은 기본 검증에서 실행하지 않는다.
- 네이버 자동 발행, 로그인 우회, VPS Playwright 실행은 하지 않는다.
- 사용자는 게시 준비 패널에서 문구와 프롬프트를 복사해 수동으로 이미지 생성/업로드할 수 있다.

## 데이터 구조

- `thumbnailTitle`
- `thumbnailSubtitle`
- `thumbnailHook`
- `thumbnailStyle`
- `thumbnailPrompt`
- `thumbnailStatus`
- `thumbnailImageUrl`
- `thumbnailVariants`
- `thumbnailErrorMessage`
- `thumbnailTemplateType`
- `thumbnailPrimaryText`
- `thumbnailSecondaryText`
- `thumbnailKeywords`

## 템플릿

### KOREA_DAILY_PREVIEW

- 메인 문구: 오늘의 한국장 전망
- 방향: 코스피/코스닥, 환율/금리/수급/섹터 흐름
- 스타일: 딥 네이비 도시 실루엣, 화이트 대형 제목, 블루 차트 포인트

### KOREA_MARKET_CLOSE_US_PREVIEW

- 메인 문구: 오늘의 미국장 전망
- 방향: 국내 마감 이후 미국 선물/금리/실적 흐름
- 스타일: 딥 네이비 야간 도시 실루엣, 화이트 대형 제목, 골드 포인트

### WEEKLY_MARKET_REVIEW

- 메인 문구: 한국·미국 주간 시장 정리
- 방향: 섹터와 주요 이벤트 복기
- 스타일: 딥 네이비 도시 실루엣, 주간 차트, 리포트 표지

### NEXT_WEEK_MARKET_PREVIEW

- 메인 문구: 다음 주 증시 전망
- 방향: 경제지표와 실적 일정 프리뷰
- 스타일: 딥 네이비 도시 실루엣, 퍼플/블루 일정 포인트

## BG Market Note 전용 시각 규칙

- 썸네일 비율은 네이버 카드 노출에 맞춘 `1200 x 675` 16:9를 기본으로 한다.
- 딥 네이비 배경, 일반화된 도시 실루엣, 캔들/라인 차트, 큰 제목과 짧은 보조 문구를 사용한다.
- 제목과 보조 문구는 중앙 안전 영역 안에 배치해 네이버 크롭에서도 핵심 문구가 남도록 한다.
- 실제 뉴스 사진, 특정 랜드마크, 뉴스/증권사/상장사 로고를 복제하지 않는다.
- 실제 조회값이 아닌 가짜 지수 숫자는 이미지에 넣지 않는다.
- 하단에는 `BG MARKET NOTE`와 자체 생성 그래픽 표기를 유지한다.

## 글 제목 규칙

- 한국 일일: `M/D 오늘의 한국장 전망 핵심 이슈`
- 한국 마감·미국 프리뷰: `M/D 오늘의 미국장 전망 핵심 이슈`
- 주간 리뷰: `M월 N주차 한국·미국 주간 시장 정리 핵심 이슈`
- 다음 주 프리뷰: `M/D 다음 주 증시 전망 핵심 이슈`

핵심 이슈는 Hermes writer/marketing 결과를 우선 사용하고, 유효한 이슈가 없으면 금리·환율·수급·실적 등 템플릿별 중립 체크 문구를 사용한다.

## 금지 표현

- 급등 확정
- 무조건 상승
- 매수 추천
- 수익 보장
- 상한가 확정
- 몰빵

썸네일 문구 생성 시 위 표현은 사용하지 않는다.

## Naver Draft Job 연계

Draft Job은 현재 `thumbnailText`와 `thumbnailPrompt`를 중심으로 전달한다. API 응답에는 호환 필드로 `thumbnailTitle`, `thumbnailImageUrl`, `thumbnailKeywords` 등을 함께 노출할 수 있게 준비한다.
