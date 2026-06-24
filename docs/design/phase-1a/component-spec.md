# BG Company 관제 시스템 — 컴포넌트 명세 (Phase 1)

방향: **안 B 모던 관제 디오라마** · 기준 화면 **1440 × 900** · 폰트 **Pretendard**
모든 값은 px. 색상·치수 토큰은 `design-tokens.json` 참조.

---

## 0. 화면 골격 (4영역 고정 레이아웃)

```
┌───────────────────────────────────────────────────────────┐
│  상단 상태 바  (height 62)                                  │
├──────┬──────────────────────────────────────────┬─────────┤
│ 좌측 │            중앙 3D 뷰포트                  │  우측   │
│ 네비 │     (React Three Fiber Canvas 마운트)     │  직원   │
│ 104  │        viewport inner 964 × 810           │  패널   │
│      │     · HUD 오버레이는 Canvas 바깥 HTML     │  344    │
└──────┴──────────────────────────────────────────┴─────────┘
```

- 좌측 네비(104) · 우측 패널(344)은 **항상 고정 폭**. 직원 선택 여부와 무관하게 폭이 변하지 않음 → 중앙 3D Canvas의 종횡비가 선택/해제 시 바뀌지 않아 카메라 리플로우가 발생하지 않는다. (의도된 결정)
- 중앙 main 패딩 14. 뷰포트 카드 radius 18.

---

## 1. 상단 KPI 카드 (Top Status Bar)

| 항목 | 값 |
|---|---|
| 높이 | 62, 배경 `surface`, 하단 `border.strong` 1px |
| 좌측 락업 | 로고 마크 30×30 (radius 9, brand bg) + "BG Company" 17/800 + "가상 회사 관제" 12/600 muted |
| 라이브 클록 | pill (radius 999, bg #F4F7FB, border #E6EBF2). 좌측 live dot 7px(`status.done.dot`, breathing) + 시:분:초 13/700 tabular |
| KPI 그룹 | 우측 정렬. 각 항목 = 세로 스택(라벨 11/600 muted + 값 18/800 tabular), 좌측 구분선 `border.soft` 1px, 좌우 패딩 18 |
| KPI 항목(6) | 업무 중(명) · 진행 중 업무 · 승인 대기(`status.waiting.dot`) · 오류(`status.error.dot`) · 오늘 AI 비용 · 이번 달 |
| 설정 | 끝 gear 버튼 36×36 (radius 11, bg #F8FAFC, border #E6EBF2) |
| 로딩 | KPI 영역 위에 skeleton 오버레이(블록 6 + gear) |

승인 대기·오류 KPI는 클릭 가능(해당 항목 0이면 회색 처리, 비활성).

## 2. 좌측 메뉴 항목 (Nav Item)

| 속성 | 값 |
|---|---|
| 컨테이너 | 폭 104, 패딩 8, 항목 gap 5 |
| 항목 | 세로 스택(아이콘 20 + 라벨 11/600), 패딩 9/4, radius 13 |
| 기본 | 아이콘·텍스트 `text.muted` (#8A94A6) |
| 선택(active) | bg `brand.tint`, 아이콘 stroke `brand.primary`, 텍스트 `brand.primaryPress`/700 |
| 배지 | 항목 우상단 카운트 배지(min 16, radius 8, bg `status.error.dot`, 흰 10/700) — 예: 승인함 "3" |
| 11개 | 대표실·가상 오피스·업무 보드·승인함·콘텐츠·재정·주식·개발·지식관리·감사·품질·보고서 |

## 3. 상태 배지 (Status Badge)

- 형태: pill (radius 999), 좌측 dot 8px + 라벨 12.5/700.
- 색: `status.{group}` 의 `bg` / `dot` / `text` 3종 동시 사용.
- **색 단독 표기 금지** — 항상 dot + 텍스트 병기. 비인터랙티브(상태값 표시 전용).
- 14개 상태 → 6색 매핑은 `design-tokens.json > color.status` 참조.

## 4. 직원 도크 카드 (Dock Chip)

| 속성 | 값 |
|---|---|
| 도크 컨테이너 | 뷰포트 하단 inset 18, glass(bg rgba(255,255,255,.9) + blur16), radius 16, shadow `dock` |
| 헤더 | "사무실 직원" 12/700 + 보조 안내 11/600 muted, 우측 카운트 |
| 칩 | flex none, 패딩 8/12/8/8, radius 13, border 1.5px |
| 아바타 | 34×34 radius 10, dept color, 이니셜 14/800 흰색, 우하단 상태 dot 11px(흰 테 2px) |
| 텍스트 | 이름 13/700 + 상태 라벨 10.5/600(상태 dot 색) |
| 기본 / 선택 | border `border.faint` bg `surface` / border `brand.primary` bg `brand.tint` |
| 가로 스크롤 | 8명 초과 시 overflow-x, custom scrollbar |
| 빈/로딩 | "표시할 직원이 없습니다" / skeleton 칩 5개 |

## 5. 직원 상세 패널 (Right Panel)

폭 344. 구성 순서:
1. **탭 바**(높이 48): 요약 · 결과물 · 타임라인 세그먼트 + 우측 닫기(×) 30×30.
2. **프로필**: 아바타 54(radius 16) + 상태 dot 15px / 이름 19/800 / "{부서} · AI 에이전트" 12.5/600 / 상태 배지.
3. **요약 탭**:
   - (오류 시) 오류 배너: border #F4CDBE, bg #FDF1EC, 경고 아이콘 + 사유.
   - 현재 업무 카드: 라벨 + 업무명 14/600 + 진행률 바(높이 8, track #EBEFF5, fill = 상태 dot) + % 13/800.
   - 지표 그리드 2열: 시작 시각 · 현재 비용 · (전폭) 사용 중인 모델.
   - 최근 결과물 카드: 아이콘 34 + 제목 13.5/700 + 메타.
   - (승인 대기 시) 승인 요청 카드: bg #FDF7E7, [승인](done) / [반려](outline) 버튼 높이 40.
   - 다음 행동 카드: brand tint surface + 화살표.
4. **결과물 탭**: 결과물 행 리스트(아이콘 36 + 제목 + 메타).
5. **타임라인 탭**: 세로 스텝(노드 11px = 단계 상태색 + 연결선) + 시각 11/700 + 설명 13/600.
6. **미선택/빈**: 중앙 placeholder(아바타 아이콘 + 안내문). 로딩: skeleton.

## 6. 알림과 오류 표시

| 위치 | 표현 |
|---|---|
| 상단 KPI | 오류 카운트 `status.error` 색, 승인 대기 `status.waiting` 색 |
| 좌측 네비 | 승인함 카운트 배지(error dot) |
| 뷰포트 | 오류 발생 시 상단 중앙 **에러 토스트**(흰 카드 + #F4CDBE border + [상세 보기] 버튼) |
| 우측 패널 | 오류 직원 선택 시 요약 상단 오류 배너 + 진행률 바 error 색 |

## 7. 뷰포트 플로팅 HUD

3D Canvas **바깥** HTML 오버레이. 항상 Canvas 위 z-index.
- **상태 범례**(top-left, inset 18): 6색 2열 그리드.
- **뷰 컨트롤**(top-right): 줌·핏·레이어 버튼 38×38 glass.
- **에러 토스트**(top-center): 조건부.
- **직원 도크**(bottom): §4.
- 코너 레티클 4개(장식, 제거 가능).
- glass 스타일: `backdrop-filter: blur(14–16px) saturate(160%)`, bg rgba(255,255,255,.86–.9).
