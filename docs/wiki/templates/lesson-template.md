# 교훈 템플릿

아래 내용을 새 `docs/wiki/lessons/LESSON-YYYY-MM-DD-short-name.md` 파일에 복사합니다. 같은 `fingerprint`가 이미 있으면 새 파일을 만들지 말고 기존 교훈을 갱신합니다.

```markdown
---
id: LESSON-YYYY-MM-DD-NNN
title: 짧고 원인 중심인 제목
status: observed
severity: low|medium|high|critical
area: product-area
first_seen: YYYY-MM-DD
last_seen: YYYY-MM-DD
owner: agent-id
fingerprint: area:stage:stable-cause
policy_version: code-or-policy-version
regression_test: path/to/test-or-manual-procedure
recurrence_count: 1
---

# 제목

## 현상

관측된 사실, 오류 코드, 실행 단계를 기록합니다.

## 영향

외부 공개, 데이터, 비용, 일정에 미친 영향을 기록합니다.

## 근본 원인

증거가 없으면 `미확정`이라고 쓰고 필요한 조사 항목을 적습니다.

## 즉시 복구

안전하게 멈추거나 복구하는 순서를 기록합니다.

## 예방 규칙

담당자, 적용 위치, 앞으로 금지하거나 강제할 조건을 기록합니다.

## 검증

회귀 테스트 또는 운영 확인 방법과 결과를 기록합니다.

## 재발 기록

| 일시 | 증거 | 조치 | 결과 |
|---|---|---|---|
| YYYY-MM-DD | 실행 ID·오류 코드 | 조치 | 결과 |

## 관련 자료

- [관련 코드 또는 Runbook](relative/path.md)
```
