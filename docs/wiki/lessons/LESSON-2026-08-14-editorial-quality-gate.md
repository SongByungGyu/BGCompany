---
id: LESSON-2026-08-14-002
title: 짧거나 불완전한 본문은 게시 단계로 넘기지 않음
status: contained
severity: high
area: stock-blog
first_seen: 2026-08-14
last_seen: 2026-08-14
owner: content-writer
fingerprint: stock-blog:quality-gate:editorial-contract-too-short
policy_version: editorial-policy-v7
regression_test: apps/web/src/lib/stock-blog/quality-gate.test.ts
recurrence_count: 1
---

# 짧거나 불완전한 본문은 게시 단계로 넘기지 않음

## 현상

생성 결과가 편집 정책의 최소 본문 길이와 필수 구조를 만족하지 못해 품질 게이트에서 차단됐다. 관측된 한 실행의 본문은 157자로, 게시 가능한 완성 원고가 아니었다.

## 영향

- 예약 글은 게시되지 않았다.
- 품질 게이트가 저품질 공개를 막았으므로 외부 독자 영향은 없었다.
- 원인 구분 없이 Writer와 QA를 반복 호출하면 같은 결함을 더 비싸게 재생산할 수 있다.

## 근본 원인

본문이 편집 정책 v7의 길이와 구조 계약을 지키지 못한 사실은 확인됐다. 생성 응답이 짧아진 상위 원인은 아직 미확정이며, Writer 출력·QA 수정 피드백·Hermes 실행 결과를 같은 실행 ID로 추적해야 한다.

## 즉시 복구

1. 품질 게이트를 완화하지 않고 해당 결과를 미게시 상태로 유지한다.
2. Writer 원문, 구조화된 QA 요구, 실행 종료 상태를 함께 확인한다.
3. 검증된 참고자료 범위 안에서만 재작성한다.
4. 최대 QA 시도 횟수에 도달하면 자동 반복 대신 운영 검토로 전환한다.

## 예방 규칙

- Writer 결과는 QA 진입 전 기본 길이와 필수 섹션 계약을 검사한다.
- QA 피드백은 `blockingIssues`, 기대값, 실제값, 수정 지시로 구조화한다.
- 한 번에 가장 중요한 차단 사유 3~5개만 Writer에게 전달한다.
- `qaRevisionAttempt`와 생성·게시 재시도 횟수를 분리해 기록한다.
- 최소 길이나 필수 구조 기준을 통과시키기 위해 품질 게이트를 낮추지 않는다.

## 검증

- 편집 정책 v7이 콘텐츠 유형별 길이와 구조 위반을 검사한다.
- QA 재수정 정책은 최대 3회 시도와 Hermes 호출 상한을 적용한다.
- 품질 게이트가 관측된 불완전 원고를 차단해 게시 단계로 넘기지 않았다.
- 상위 원인 수정 후에는 동일 입력의 회귀 테스트와 실제 운영 1회를 추가로 확인해야 `verified`로 전환한다.

## 재발 기록

| 일시 | 증거 | 조치 | 결과 |
|---|---|---|---|
| 2026-08-14 07:50 KST | 품질 점수 40, 본문 157자, 필수 구조 누락 | 품질 게이트 차단 | 미게시, 원인 조사 필요 |

## 관련 자료

- [QA 재수정 정책](../../../apps/web/src/lib/stock-blog/qa-revision-policy.ts)
- [편집 정책](../../../apps/web/src/lib/stock-blog/stock-blog-editorial-policy.ts)
- [품질 게이트](../../../apps/web/src/lib/stock-blog/quality-gate.ts)
- [품질 게이트 회귀 테스트](../../../apps/web/src/lib/stock-blog/quality-gate.test.ts)
- [주식 브리핑 품질 게이트 문서](../../stock-blog/stock-briefing-quality-gate.md)
