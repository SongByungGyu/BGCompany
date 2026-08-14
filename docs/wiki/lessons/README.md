# 교훈 원장

운영 실패를 원인 단위로 모으는 목록입니다. 같은 `fingerprint`는 하나의 문서에서 재발 횟수와 시간순 기록을 누적합니다.

## 현재 교훈

| ID | 제목 | 상태 | 심각도 | 담당 | 재발 횟수 | 마지막 확인 |
|---|---|---|---|---|---:|---|
| [LESSON-2026-08-14-001](LESSON-2026-08-14-reference-preflight.md) | 검증된 시장 데이터가 없으면 생성 전에 안전 정지 | contained | high | stock-monitor | 2 | 2026-08-14 |
| [LESSON-2026-08-14-002](LESSON-2026-08-14-editorial-quality-gate.md) | 짧거나 불완전한 본문은 게시 단계로 넘기지 않음 | contained | high | content-writer | 1 | 2026-08-14 |

## 새 교훈 추가

1. 기존 목록과 문서의 `fingerprint`를 검색합니다.
2. 같은 원인이 없을 때만 [교훈 템플릿](../templates/lesson-template.md)을 복사합니다.
3. 파일명은 `LESSON-YYYY-MM-DD-short-name.md`로 만듭니다.
4. 필수 메타데이터와 모든 섹션을 채웁니다.
5. `npm run test:wiki`로 중복과 링크를 확인합니다.

상태와 책임 기준은 [위키 운영 규칙](../governance.md)을 따릅니다.
