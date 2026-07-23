# Dashboard Summary

대표실 화면의 `오늘의 운영 브리핑`은 LLM 호출 없이 DB 상태를 규칙 기반으로 요약한다.

## API

`GET /api/dashboard-summary`

- 관리자 세션 필요
- 비로그인 요청은 JSON 401 반환
- Hermes/OpenAI 호출 없음

## 요약 대상

- Task 상태
- Approval 대기/완료 상태
- ContentPipeline 상태
- NaverDraftJob 상태
- Hermes usage/recent runs
- AgentRun 최근 실행
- 직원별 진행 Task: 이름, 업무명, 현재 단계, 상태, 최근 갱신 시각
- 최근 AgentRun: 이름, 연결된 업무, 실행 결과 또는 오류, 모드, 완료 시각

## 카드 구성

- 콘텐츠 파이프라인
- Hermes 사용량
- 네이버 임시저장
- 승인/업무 상태
- 최근 Agent 실행
- 직원별 진행 업무
- 에이전트가 수행한 최근 작업

## 운영 원칙

대시보드 요약은 관제용 문장화 계층이다. 판단을 돕지만 자동으로 외부 API나 Hermes를 실행하지 않는다.

직원 활동 영역은 실제 `Task`와 `AgentRun` 기록만 읽는다. 대표실 화면을 열거나 새로고침하는 동작은 LLM을 호출하지 않으며, 실행 기록이 없는 작업을 임의로 생성하지 않는다.
