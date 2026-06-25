# BG Company 3D 사무실 구조 확정안

## 0. 문서 목적

이 문서는 **Phase 1-A 2단계: 3D 사무실 그레이박스 구현**의 기준 문서다.

- 현재 완료된 관제 UI 골격은 유지한다.
- 중앙 `OfficeViewport` 내부만 React Three Fiber 기반 3D 장면으로 교체한다.
- 이번 단계에서는 실제 가구 에셋, 캐릭터 모델, 애니메이션을 추가하지 않는다.
- 모든 좌표와 크기는 추후 `config/office-layout.json`에서 수정 가능해야 한다.

---

## 1. 전체 콘셉트

- 형태: PC 웹용 3D 디오라마형 AI 가상 오피스
- 층수: 1층
- 예상 직원 수: 7명, 추후 8명 이상 확장
- 카메라: 고정 쿼터뷰 중심
- 분위기: 따뜻한 파스텔 계열의 로우폴리 미니어처 오피스
- 벽: 외곽은 일반 벽, 내부는 낮은 벽과 유리벽 혼합
- 화면에서 왼쪽 위 대표실과 위 가운데 회의실이 명확히 보여야 한다.
- 중앙 개발·운영 워크존이 시각적 중심이 된다.

---

## 2. 좌표계와 전체 크기

React Three Fiber 월드 좌표 기준:

- `x`: 좌우, 왼쪽 음수 / 오른쪽 양수
- `y`: 높이
- `z`: 상하, 화면 위쪽 음수 / 화면 아래쪽 양수
- 바닥 높이: `y = 0`
- 사무실 전체 크기: `24 × 16`
- 전체 범위:
  - x: `-12 ~ 12`
  - z: `-8 ~ 8`

초기 그레이박스 배치는 아래 값을 사용하되, 모두 `config/office-layout.json`으로 분리한다.

---

## 3. 전체 공간 배치

```text
┌────────────────────┬────────────────────────────┬────────────────────┐
│      대표실         │          대회의실           │   콘텐츠/마케팅 존  │
│  director-room     │       meeting-room         │   content-zone     │
├────────────────────┼────────────────────────────┼────────────────────┤
│ 소회의/리뷰 공간    │      개발/운영 워크존       │   재정/주식 존      │
│ review-zone        │        dev-ops-zone         │ finance-stock-zone │
├────────────────────┼────────────────────────────┼────────────────────┤
│ 휴게 라운지         │ 로비·공용공간 + 탕비/커피존  │ 지식관리/감사실     │
│ break-lounge       │ lobby-common-zone          │ knowledge-audit    │
└────────────────────┴────────────────────────────┴────────────────────┘
```

---

## 4. 공간별 초기 위치와 크기

| 공간 ID | 표시 이름 | 중심 위치 `[x,y,z]` | 크기 `[w,d]` | 비고 |
|---|---|---:|---:|---|
| `director-room` | 대표실 | `[-8.5,0,-5.25]` | `[7,5.5]` | 좌측 상단 |
| `meeting-room` | 대회의실 | `[0,0,-5.25]` | `[10,5.5]` | 상단 중앙 |
| `content-zone` | 콘텐츠·마케팅 | `[8.5,0,-5.25]` | `[7,5.5]` | 상단 우측 |
| `review-zone` | 소회의·리뷰 | `[-8.5,0,0.25]` | `[7,5.5]` | 중앙 좌측 |
| `dev-ops-zone` | 개발·운영 | `[0,0,0.25]` | `[10,5.5]` | 중앙 중심 |
| `finance-stock-zone` | 재정·주식 | `[8.5,0,0.25]` | `[7,5.5]` | 중앙 우측 |
| `break-lounge` | 휴게 라운지 | `[-8.5,0,5.5]` | `[7,5]` | 하단 좌측 |
| `lobby-common-zone` | 로비·공용공간 | `[0,0,5.5]` | `[10,5]` | 하단 중앙, 이동 허브 |
| `knowledge-audit-zone` | 지식관리·감사 | `[8.5,0,5.5]` | `[7,5]` | 하단 우측 |
| `pantry-coffee-zone` | 탕비·커피존 | `[2.8,0,5.8]` | `[4,3.8]` | 로비 오른쪽 벽면 내부 |

### 배치 원칙

- `pantry-coffee-zone`은 독립 방이 아니라 `lobby-common-zone` 안의 하위 구역이다.
- 탕비·커피존은 메인 이동 통로를 막지 않도록 로비 오른쪽 벽면에 붙인다.
- `lobby-common-zone` 중앙은 캐릭터 이동 허브로 비워둔다.
- 중앙 구역 통로는 캐릭터 2명이 교차할 수 있도록 충분히 넓게 둔다.

---

## 5. 공간별 역할과 목적지

### 대표실 `director-room`

- 사용자: `director`
- 벽: 유리벽과 낮은 벽 혼합
- 목적지:
  - `director-desk`
  - `director-report-point`
  - `approval-wait-point`

### 대회의실 `meeting-room`

- 좌석: 6~8석
- 목적지:
  - `meeting-entrance`
  - `meeting-presenter-point`
  - `meeting-seat-01` ~ `meeting-seat-06`

### 콘텐츠·마케팅 존 `content-zone`

- 사용자:
  - `content-planner`
  - `marketing-manager`
- 목적지:
  - `content-desk-01`
  - `content-desk-02`

### 소회의·리뷰 공간 `review-zone`

- 용도:
  - 1:1 검토
  - 콘텐츠 수정 회의
  - QA 검토
  - 소규모 브레인스토밍
- 목적지:
  - `review-seat-01`
  - `review-seat-02`
  - `review-presenter-point`

### 개발·운영 워크존 `dev-ops-zone`

- 사용자:
  - `developer`
  - 향후 운영·자동화 Agent
- 목적지:
  - `dev-desk-01`
  - `dev-desk-02`
  - `ops-desk-01`
  - `error-response-point`

### 재정·주식 존 `finance-stock-zone`

- 사용자:
  - `finance-manager`
  - `stock-monitor`
- 목적지:
  - `finance-desk-01`
  - `stock-desk-01`

### 휴게 라운지 `break-lounge`

- 목적지:
  - `break-seat-01`
  - `break-seat-02`
  - `break-seat-03`

### 로비·공용공간 `lobby-common-zone`

- 용도:
  - 사무실 입구
  - 부서 간 이동 허브
  - 출근·퇴근 연출
  - 공용 프린터
  - 탕비·커피존
- 목적지:
  - `entrance-point`
  - `lobby-center`
  - `main-crossroad`
  - `common-printer`

### 탕비·커피존 `pantry-coffee-zone`

- 상위 공간: `lobby-common-zone`
- 위치: 로비 오른쪽 벽면
- 목적지:
  - `coffee-machine-point`
  - `water-dispenser-point`
  - `pantry-counter-point`
  - `pantry-stool-01`
  - `pantry-stool-02`

### 지식관리·감사실 `knowledge-audit-zone`

- 사용자:
  - `qa-auditor`
  - 향후 지식관리 Agent
- 목적지:
  - `audit-desk-01`
  - `knowledge-desk-01`
  - `knowledge-search-point`

---

## 6. 직원별 기본 좌석

| 직원 ID | 표시 이름 | 부서 | 기본 좌석 |
|---|---|---|---|
| `director` | 대표 | 대표실 | `director-desk` |
| `content-planner` | 콘텐츠 기획자 | 콘텐츠팀 | `content-desk-01` |
| `marketing-manager` | 마케팅 담당자 | 콘텐츠팀 | `content-desk-02` |
| `developer` | 개발 담당자 | 개발팀 | `dev-desk-01` |
| `finance-manager` | 재정 담당자 | 재정팀 | `finance-desk-01` |
| `stock-monitor` | 주식 모니터 | 주식팀 | `stock-desk-01` |
| `qa-auditor` | QA·감사 담당자 | 지식·감사팀 | `audit-desk-01` |

---

## 7. 출입구와 이동 연결

| 출입구 ID | 연결 공간 | 초기 위치 설명 |
|---|---|---|
| `door-director` | 대표실 ↔ 중앙 통로 | 대표실 하단 중앙 |
| `door-meeting` | 회의실 ↔ 중앙 통로 | 회의실 하단 중앙 |
| `door-content` | 콘텐츠 존 ↔ 중앙 통로 | 콘텐츠 존 하단 중앙 |
| `door-review` | 리뷰 존 ↔ 로비 방향 | 리뷰 존 하단 또는 우측 |
| `door-finance-stock` | 재정·주식 존 ↔ 로비 방향 | 재정·주식 존 하단 또는 좌측 |
| `door-break` | 휴게실 ↔ 로비 | 휴게실 오른쪽 |
| `door-knowledge-audit` | 지식·감사실 ↔ 로비 | 지식·감사실 왼쪽 |
| `door-main-entrance` | 외부 ↔ 로비 | 로비 하단 중앙 |

### 이동 원칙

- `lobby-center`와 `main-crossroad`를 모든 부서 이동의 중심 노드로 사용한다.
- 대표실과 회의실 앞에는 여러 직원이 잠시 대기할 공간을 둔다.
- 탕비·커피존은 로비의 주 이동 경로와 겹치지 않는다.
- 실제 NavMesh 또는 경로 탐색은 후속 단계에서 구현한다.

---

## 8. 카메라

초기 카메라는 `OrthographicCamera`를 우선 사용한다.

- 위치: `[18, 20, 22]`
- 타깃: `[0, 0, 0]`
- 전체 사무실이 1440×900 기준 중앙 뷰포트에 들어와야 한다.
- 하단 직원 도크가 가리는 영역을 고려해 사무실을 약간 위쪽으로 배치한다.
- 앞쪽 외벽은 낮게 하거나 숨겨 내부 공간이 잘 보이게 한다.
- 카메라 회전은 Phase 1-A에서는 비활성화한다.
- 줌은 개발 확인용으로만 허용하고 기본 화면은 고정한다.

---

## 9. 벽과 그레이박스 표현

- 외벽 높이: 약 `1.2`
- 내부 낮은 벽 높이: 약 `0.65`
- 대표실·회의실 유리벽 높이: 약 `1.4`
- 벽 두께: 약 `0.12`
- 각 공간은 서로 다른 연한 파스텔 임시 색상으로 구분한다.
- 공간 ID 라벨은 개발 모드에서만 보이게 한다.
- 바닥, 벽, 라벨은 모두 설정 파일 기반으로 생성한다.

---

## 10. 상태별 이동 목적

| 상태 | 기본 이동 위치 |
|---|---|
| 대기 중 | 기본 좌석 또는 `lobby-center` |
| 이동 중 | 지정된 목적지 |
| 업무 중 | 자기 책상 |
| 조사 중 | 자기 책상 또는 `knowledge-search-point` |
| 회의 중 | 회의실 지정 좌석 |
| 검토 중 | `review-zone` |
| 결과 대기 | 기본 좌석 |
| 승인 대기 | `approval-wait-point` |
| 수정 중 | 자기 책상 |
| 보고 중 | `director-report-point` |
| 오류 대응 중 | `error-response-point` |
| 업무 완료 | 대표 보고 후 기본 좌석 |
| 휴식 중 | `break-lounge` 또는 `pantry-coffee-zone` |
| 업무 종료 | `entrance-point`로 이동 후 퇴장 |

---

## 11. 이번 단계 구현 범위

### 포함

- React Three Fiber Canvas
- OrthographicCamera
- 바닥
- 외벽
- 내부 구획 벽
- 출입구
- 기본 조명
- 개발용 공간 라벨
- `config/office-layout.json`
- 설정 기반 렌더링
- 기존 관제 UI 유지

### 제외

- 실제 가구 GLB
- 실제 캐릭터 모델
- 걷기·앉기·타이핑 애니메이션
- 경로 탐색
- Hermes 연동
- 실제 업무 데이터
- 자유 카메라
- 다층 구조
- 사무실 꾸미기

---

## 12. 완료 기준

- 기존 Phase 1-A UI가 깨지지 않는다.
- 중앙 뷰포트만 실제 3D Canvas로 교체된다.
- 9개 주요 공간과 탕비·커피존이 구분된다.
- 왼쪽 위 대표실, 위 가운데 회의실, 중앙 개발존이 명확히 보인다.
- 모든 공간 위치와 크기를 JSON에서 수정할 수 있다.
- 개발용 라벨 표시를 켜고 끌 수 있다.
- `npm run lint`와 `npm run build`가 통과한다.
- 1440×900 기준 캡처를 저장한다.
