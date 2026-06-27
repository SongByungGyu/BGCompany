# Phase 1-C Content Pipeline

## 목적

콘텐츠 파이프라인은 실제 Hermes/LLM 연결 전에 BG Company가 콘텐츠 업무를 회사 업무 흐름처럼 처리하는지 검증하기 위한 Phase 1-C 기능입니다.

현재 단계에서는 별도 `ContentPipeline` DB 모델을 추가하지 않고, 기존 DB 리소스를 조합합니다.

- Task
- ApprovalRequest
- EventLog
- Timeline
- AgentRun

## 실행 흐름

```text
POST /api/content-pipelines
→ 콘텐츠 기획 task 생성
→ 마케팅 검토 task 생성
→ QA 검토 task 생성
→ 각 task에 AgentRun 기록 생성
→ OutputGenerated / TaskStarted event 저장
→ Director 승인 요청 생성
→ ApprovalRequested event 저장
→ 업무 보드 / 승인함 / 직원 timeline / 3D 상태에 polling으로 반영
```

## API

```text
GET /api/content-pipelines
POST /api/content-pipelines
```

요청 예시:

```json
{
  "topic": "AI 개인회사 구축 과정 정리",
  "channel": "blog",
  "title": "BG Company 구축기 1편",
  "runnerMode": "mock"
}
```

지원 channel:

- `blog`
- `instagram`
- `youtube`
- `newsletter`

지원 runnerMode:

- `mock`
- `hermes-dry-run`
- `hermes`

## Pipeline 단계

```text
draft_requested
planning
marketing_review
qa_review
director_approval
approved
rejected
published_ready
completed
```

현재 API는 즉시 실행 방식으로 content/marketing/QA task를 생성하고 Director 승인 대기 상태까지 진행합니다.

## Agent 역할

### content-planner

- 콘텐츠 주제 기획
- 제목/개요/초안 방향 생성
- OutputGenerated event 생성

### marketing-manager

- 제목/썸네일/홍보 문구 검토
- marketing_review 단계 담당
- OutputGenerated event 생성

### qa-auditor

- 사실성/정책/품질 기준 검토
- qa_review 단계 담당
- OutputGenerated event 생성

### director

- 최종 승인 대기
- ApprovalRequested event와 승인함 항목 생성

## UI

좌측 메뉴의 `콘텐츠` 화면에서 다음을 제공합니다.

- topic 입력
- title 입력
- channel 선택
- runnerMode 선택
- 파이프라인 시작
- 최근 파이프라인 목록
- 관련 task / approval 표시
- 결과물 요약 표시

## 기존 기능 연동

- 업무 보드: 생성된 content/marketing/QA task 표시
- 승인함: Director 콘텐츠 최종 승인 요청 표시
- timeline: task/employee/approval timeline 생성
- 3D 오피스: DB polling 후 직원 상태 반영 가능
- Hermes: 실제 연결 전에는 `mock` 또는 `hermes-dry-run` 기반으로 검증

## 제외 범위

이번 단계에서는 다음을 하지 않습니다.

- 실제 블로그 게시
- 실제 외부 메시지 발송
- 실제 Hermes/LLM 실행 강제
- 금융/주식 API 연동
- 송금/결제/매수/매도
- 사용자 로그인/인증
- 배포
- GLB 캐릭터 교체
- 3D 오피스 대규모 수정
