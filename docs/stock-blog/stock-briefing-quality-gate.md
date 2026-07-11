# Stock Briefing Quality Gate

BG Company의 주식 블로그 운영 콘텐츠는 실제 Hermes 실행이라도 아래 품질 게이트를 통과해야 자동 승인/네이버 임시저장 단계로 넘어갈 수 있다.

## 실참조 기준

- `runnerMode=hermes`에서는 mock/reference-disabled 자료를 운영 참고자료로 인정하지 않는다.
- 실제 참고자료는 title, publisher, url, publishedAt, summary를 가져야 한다.
- 유효한 HTTP(S) URL 기준 3개 이상, 서로 다른 발행처 2곳 이상을 요구한다.
- `Mock Market Desk`, `BG Reference Lab`, `실제 API를 호출하지 않음`, `manual-only`, `real-disabled` 등은 차단한다.

## 본문 기준

- 최종 네이버 붙여넣기 본문 기준 줄바꿈 12개 이상
- 문단 블록 7개 이상
- 섹션 제목 6개 이상
- 불릿 4개 이상
- 공백 제외 1500자 이상
- 투자 유의문구 포함
- 이미지 프롬프트는 본문에 섞지 않고 게시 준비 패널에만 둔다.

## 실패 상태

- `needs_reference`: 실참조 부족 또는 mock 참조 감지
- `needs_data`: 지수/섹터/수급 등 시장 데이터 신호 부족
- `readability_failed`: 줄바꿈/문단/섹션 구조 부족
- `duplicate_content_failed`: 반복 문장 과다
- `image_pending`: 이미지 프롬프트가 본문에 누출됨
- `quality_failed`: 기타 품질 기준 실패

품질 게이트 실패 시 자동 승인, 네이버 Draft Job 생성, publish-ready 전환을 막는다.


## 참고자료 Provider 품질 기준

Hermes 실제 실행 결과는 `ReferenceBundle` 품질 기준을 통과해야 한다.

- `provider=mock` 또는 `mode=mock/real-disabled`는 운영 결과로 인정하지 않는다.
- 실제 참고자료 3개 이상, 중복 없는 URL 3개 이상, 발행처 2곳 이상이 필요하다.
- 각 브리핑 템플릿은 최소 1개의 시장 데이터 또는 공식/신뢰 참고자료를 요구한다.
- 필수 참고자료가 부족하면 `needs_reference` 상태로 자동 승인과 네이버 임시저장을 막는다.
