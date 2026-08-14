---
id: LESSON-2026-08-14-001
title: 검증된 시장 데이터가 없으면 생성 전에 안전 정지
status: contained
severity: high
area: stock-blog
first_seen: 2026-08-13
last_seen: 2026-08-14
owner: stock-monitor
fingerprint: stock-blog:reference-preflight:missing-verified-market-data
policy_version: code-6c692bf24ca6
regression_test: apps/web/src/lib/stock-blog/stock-blog-scheduler-policy.test.ts
recurrence_count: 2
---

# 검증된 시장 데이터가 없으면 생성 전에 안전 정지

## 현상

스케줄러가 `STOCK_REFERENCE_PREFLIGHT_BLOCKED`와 `needs_credentials` 또는 `needs_data` 상태를 반환하며 본문 생성을 시작하지 않았다.

## 영향

- 해당 예약 시각의 글이 생성·게시되지 않았다.
- 안전 정지 덕분에 검증되지 않은 숫자나 출처를 포함한 글은 외부에 공개되지 않았다.
- 단순 재시도만 반복하면 같은 데이터 조건에서 비용과 운영 소음이 늘어날 수 있다.

## 근본 원인

시장 데이터 Provider의 인증 상태 또는 최신 시장 스냅샷이 품질 게이트의 필수 조건을 만족하지 못했다. 비밀정보의 실제 값은 위키에 기록하지 않는다.

## 즉시 복구

1. `.env`의 필요한 변수는 값이 아니라 설정 여부만 확인한다.
2. Provider 상태를 `needs_credentials`, `needs_data`, `error`로 구분한다.
3. 거래일·데이터 최신성·필수 지수와 섹터 필드가 준비된 뒤에만 재시도한다.
4. 긴급 상황에서도 가짜 Reference나 추정 시장 수치를 삽입하지 않는다.

## 예방 규칙

- Hermes 호출 전에 Reference preflight를 통과해야 한다.
- 인증 실패는 자동 반복 재시도하지 않고 운영 확인 대상으로 분류한다.
- 일시적인 데이터 부재만 제한된 횟수와 간격으로 재시도한다.
- 같은 `fingerprint`가 7일 안에 두 번 이상 발생하면 Provider 상태와 스케줄 시각을 주간 회고 안건으로 올린다.

## 검증

- 스케줄러 정책 테스트가 preflight 차단 상태를 재시도 가능 여부와 함께 검증한다.
- 품질 게이트는 실제 Reference와 MarketSnapshot이 준비되지 않으면 `ok: false`를 반환한다.
- 2026-08-14 운영에서 차단 후 외부 게시가 발생하지 않았음을 확인했다.

## 재발 기록

| 일시 | 증거 | 조치 | 결과 |
|---|---|---|---|
| 2026-08-13 | preflight 1차 실패 | 제한된 재시도 | 2차 시도에서 조건 회복 |
| 2026-08-14 07:20 KST | `needs_credentials`·검증 스냅샷 부재 | 안전 정지 유지 | 미게시 |

## 관련 자료

- [운영 Runbook의 Stock reference preflight](../../operations/runbook.md)
- [품질 게이트 구현](../../../apps/web/src/lib/stock-blog/quality-gate.ts)
- [스케줄러 정책](../../../apps/web/src/lib/stock-blog/stock-blog-scheduler-policy.ts)
- [스케줄러 정책 회귀 테스트](../../../apps/web/src/lib/stock-blog/stock-blog-scheduler-policy.test.ts)
- [Reference Provider 안내](../../stock-blog/real-reference-provider.md)
