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

- 메인 문구: 오늘의 한국장 체크
- 방향: 장전 핵심 변수, 환율/금리/섹터 흐름
- 스타일: 네이비/화이트/골드, 아침 브리핑 카드

### KOREA_MARKET_CLOSE_US_PREVIEW

- 메인 문구: 한국장 마감 · 미국장 프리뷰
- 방향: 국내 수급과 미국 선물 흐름
- 스타일: 화이트 카드, 네이비 헤더, 블루 포인트

### WEEKLY_MARKET_REVIEW

- 메인 문구: 주간 시장 정리
- 방향: 섹터와 주요 이벤트 복기
- 스타일: 딥 네이비 그라데이션, 골드 라인, 리포트 표지

### NEXT_WEEK_MARKET_PREVIEW

- 메인 문구: 다음 주 증시 체크
- 방향: 경제지표와 실적 일정 프리뷰
- 스타일: 화이트/블루/네이비 캘린더 카드

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
