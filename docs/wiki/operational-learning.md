# 운영 학습 시스템

BG Company의 장기 학습은 모델이 임의로 정책을 바꾸는 방식이 아닙니다. 운영 실패를 자동 분류하고, 반복 원인에 대해 개선안을 만들고, 사람의 승인과 회귀 검증을 통과한 규칙만 다음 Agent 실행에 적용합니다.

## 전체 흐름

```text
ErrorOccurred 또는 scheduler failed/partial_failed
  → 민감정보 제거
  → area:stage:cause fingerprint 생성
  → correlation ID로 동일 실행 중복 제거
  → 발생 횟수·최근 7일 기록 갱신
  → 같은 fingerprint 2회 이상
  → 루나의 운영 개선 ApprovalRequest 생성
  → CEO 승인
  → 관련 Agent Hermes 입력에 예방 규칙 주입
  → 회귀 테스트·운영 증거 등록
  → verified 전환
```

## 자동 수집 범위

- 중앙 EventLog를 통과하는 `ErrorOccurred`
- 주식 블로그 스케줄러의 `failed`와 `partial_failed`
- 주식 블로그 Reference preflight 안전 정지
- 최종 콘텐츠 품질 게이트 차단

앞 단계 실패 때문에 뒤 Agent가 실행되지 않은 `_SKIPPED_AFTER_` 이벤트는 근본 실패로 중복 집계하지 않습니다.

## 데이터 모델

`OperationalLesson`은 원인별 현재 상태를 보존합니다.

- `fingerprint`: `area:stage:stable-cause` 형식의 고유 키
- `occurrenceCount`: 전체 관측 횟수
- `approvalStatus`: `not_requested`, `pending`, `approved`, `rejected`
- `status`: `observed`, `contained`, `prevented`, `verified`, `archived`
- `proposedPreventionRule`: 반복 감지 시 자동 제안한 규칙
- `preventionRule`: CEO 승인 후 실제 적용할 규칙
- `regressionTest`, `verificationEvidence`: verified 전환 조건

`OperationalFailureOccurrence`는 각 발생의 시각, 오류 코드, correlation ID, 안전하게 축약한 메타데이터를 보존합니다. 원문 비밀키, Authorization 값, 전체 Hermes payload는 학습 원장에 저장하지 않습니다.

## 개선안 승인

최근 7일 동안 같은 원인이 두 번 확인되면 기존 승인함에 `[운영 개선]` 요청이 생성됩니다. 루나는 반복 횟수와 기본 예방 규칙을 정리하고, CEO 병규가 기존 승인함에서 승인·반려·수정 요청·보류를 결정합니다.

- 승인: `approvalStatus=approved`, `status=prevented`로 변경하고 예방 규칙 활성화
- 반려: `approvalStatus=rejected`, `status=contained` 유지
- 수정 요청·보류: 승인 전 상태를 유지하고 Agent 실행에는 적용하지 않음

## Agent 적용 안전 규칙

- 승인되고 `prevented` 또는 `verified`인 교훈만 사용합니다.
- Agent와 영역이 일치하는 최근 교훈을 최대 5개만 사용합니다.
- 교훈은 작업 제약이지 시장 사실이나 Reference가 아닙니다.
- 현재 검증 데이터, 품질 게이트, 비밀정보 보호, 외부 실행 금지와 충돌하면 하드 안전 규칙이 우선합니다.
- 품질 게이트 완화나 자동 게시 범위 확대는 교훈만으로 실행하지 않습니다.

## 관리 API

관리자 세션이 필요합니다.

```text
GET   /api/operational-lessons
PATCH /api/operational-lessons/{lessonId}
```

`PATCH`에서 관리할 수 있는 값:

```json
{
  "rootCause": "확인된 근본 원인",
  "preventionRule": "승인된 예방 규칙",
  "regressionTest": "npm run test:learning",
  "verificationEvidence": "회귀 테스트 통과와 운영 3회 정상",
  "policyVersion": "learning-policy-v1",
  "status": "verified"
}
```

승인, 예방 규칙, 회귀 테스트, 검증 증거 중 하나라도 없으면 `verified` 요청은 `409 VERIFICATION_BLOCKED`로 거부됩니다.

## 배포 전 DB 반영

Prisma schema에 운영 학습 테이블이 추가되므로 애플리케이션 배포 전에 대상 환경에서 기존 백업 정책을 확인하고 다음 명령을 실행합니다.

```bash
cd apps/web
npm run db:generate
npm run db:push
```

프로덕션 DB 반영은 별도 배포 승인 후 수행합니다. 코드만 먼저 배포해 학습 테이블이 없는 상태를 만들지 않습니다.

## 검증

```bash
cd apps/web
npm run test:learning
npm run test:wiki
```

관련 구현:

- [운영 학습 정책](../../apps/web/src/lib/operational-learning/operational-learning-policy.ts)
- [운영 학습 서비스](../../apps/web/src/lib/operational-learning/operational-learning-service.ts)
- [Prisma schema](../../apps/web/prisma/schema.prisma)
- [Event 저장소](../../apps/web/src/lib/repositories/events.ts)
- [주식 블로그 스케줄러](../../apps/web/src/lib/stock-blog/stock-blog-scheduler.ts)
