# 설명형 대체 이미지 운영 규칙 (2026-09-09)

대표 요청: 그래프 자료가 부족한 날에도 해당 글을 설명하는 이미지가 나오도록 한다.

- 검증된 정상 차트는 유지하고 사용할 수 없는 차트의 자리만 바꾼다. 빈 값은 0으로 만들지 않는다.
- 설명형 이미지는 본문 소제목 아래 내용과 공식/주요 언론 참고자료에 함께 등장하는 주제만 선택한다. 기사 목록의 키워드만으로 선택하지 않는다.
- 수급·금리/환율·시장 넓이·휴장·실적·엔화·신청 조건 등 확인 순서를 제공한다. 알 수 없는 주제나 연결 출처가 없는 경우 일반 증시 그림으로 채우지 않는다.
- 설명 이미지는 실제 가격·등락·매매 방향을 주장하지 않고, 시세 차트가 아니라는 문구를 표시한다. 남색 계열과 기존 글꼴을 유지한다.
- 본문 이미지 2~3장, 파일·출처·배치 검증은 유지한다. 대체 이미지의 주제/출처/본문 연결은 생성 및 발행 직전 모두 검사한다.
- 이미지가 생성됐다고 글을 발행할 수 있는 것은 아니다. 기존 실참고자료, 필수 시장 자료, 본문 QA 95점, 승인·중복 방지 게이트는 변경하지 않는다.
- 수치 불일치, 원문 출처 부재, 파일 오류, 검수 실패는 설명 이미지로 숨기지 않는다. 휴장 여부와 개장일은 별도 공식 검증 절차를 그대로 거친다.
- 기존 발행 글 및 예약·정규 스케줄은 변경하지 않는다. 배포 이후 새 이미지 생성에 적용한다.

회귀 테스트:

```sh
node --experimental-strip-types --loader ./scripts/image-fallback-test-loader.mjs --test apps/web/src/lib/stock-blog/stock-blog-explanatory-images.test.ts apps/web/src/lib/stock-blog/stock-blog-image-generator.test.ts apps/web/src/lib/stock-blog/stock-blog-image-quality.test.ts apps/web/src/lib/stock-blog/quality-gate.test.ts
```
