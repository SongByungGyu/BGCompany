# BG Company 관제 시스템 — 인터랙션 명세 (Phase 1)

상태 모델은 단일 `view` + `selectedIndex` + `activeTab` 로 구동.

```
view: 'selected' | 'unselected' | 'approval' | 'error' | 'empty' | 'loading'
selectedIndex: number | null
activeTab: 'summary' | 'outputs' | 'timeline'
```

> 시연/QA용 훅: `window.__bgSetView('error')` 등으로 6개 상태 강제 전환 가능 (개발 시 제거 또는 dev 플래그 처리).

---

## 1. 직원 도크 클릭 → 상세 패널 열기
- 도크 칩 클릭 → `selectedIndex = i`, `view = 'selected'`, 우측 패널이 해당 직원 상세로 즉시 스왑.
- 선택 칩은 border `brand.primary` + bg `brand.tint` 로 강조.
- 패널 전환은 **즉시**(페이드/슬라이드 없음) — 데이터만 교체. 탭은 `summary`로 리셋.

## 2. 패널 닫기 (재클릭 / 닫기 버튼)
- **같은 직원 칩 재클릭** → `view = 'unselected'`, `selectedIndex` 유지하되 패널은 placeholder.
- 패널 헤더 **닫기(×)** → `view = 'unselected'`.
- 미선택 placeholder: 아바타 아이콘 + "직원을 선택하세요" + 안내문.
- **중앙 뷰포트는 폭이 변하지 않는다.** 우측 패널은 상시 고정 레일(344)이며 내용만 placeholder↔상세로 바뀐다. → 3D Canvas 리사이즈/카메라 종횡비 변경 없음.

## 3. 좌측 메뉴 선택 상태
- 단일 선택. 활성 항목만 `brand.tint` 강조. Phase 1 기준 화면은 "가상 오피스" 활성.
- 호버: 항목 bg `surface3` 살짝(터치 환경 제외).

## 4. 탭 전환 (요약 · 결과물 · 타임라인)
- 클릭 → `activeTab` 변경, 활성 탭 bg `brand.tint`/텍스트 700. 콘텐츠 영역만 교체.
- 직원이 선택된 경우에만 탭 바 노출(미선택/빈/로딩 시 숨김).

## 5. KPI · 승인 알림 클릭
- 승인 대기 KPI / 좌측 승인함 → "승인함" 화면으로 이동(Phase 2). 카운트 0이면 비활성(회색).
- 오류 KPI → 오류 직원 자동 선택 + `view='error'` 로 점프(뷰포트 에러 토스트 + 패널 오류 배너).
- 승인 대기 직원 선택 시 패널에 **[승인]/[반려]** CTA. 승인 → done 처리/카운트 감소, 반려 → 수정 중 루프(Phase 2 연동).

## 6. 호버 · 포커스 · 선택 상태
| 요소 | 호버 | 선택/활성 | 비활성 |
|---|---|---|---|
| 버튼 | press 0.96 scale + 농도↑ 120ms | — | opacity 0.45, cursor 기본 |
| 도크 칩 | border/bg 살짝 brand | brand.primary border + tint bg | — |
| 네비 항목 | bg surface3 | brand.tint | — |
| 탭 | 텍스트 농도↑ | brand.tint bg + 700 | — |
| 상태 배지 | 없음(비인터랙티브) | — | — |
| 포커스 | `outline: 2px brand.primary` (키보드) | — | — |

## 7. 패널 열릴 때 중앙 뷰포트 조정
- **조정 없음(고정 레일 방식).** 선택/해제는 우측 패널 내부 콘텐츠 스왑일 뿐, 중앙 뷰포트 박스 크기는 불변.
- (대안 메모) 향후 패널을 접는 모드가 필요하면, 접힘 시 Canvas에 `resize` 이벤트를 디스패치하고 카메라 aspect를 갱신해야 함 — Phase 1 범위 아님.

## 8. 상태별 화면 정의 (PNG 대응)
| 파일 | view | 설명 |
|---|---|---|
| 01-selected | selected | 기본 대표 관제화면 = 직원(미나) 선택, 우측 상세 열림 |
| 02-unselected | unselected | 직원 미선택, 우측 placeholder |
| 03-approval | approval | 승인 대기 직원(카이) 선택, [승인]/[반려] CTA |
| 04-error | error | 오류 직원(하늘) 선택, 뷰포트 에러 토스트 + 패널 오류 배너 |
| 05-empty | empty | 활동 직원 0명, 뷰포트·도크·패널 빈 상태 |
| 06-loading | loading | 초기 로딩, KPI·도크·패널 skeleton + 뷰포트 스피너 |

## 9. 라이브 동작
- 클록: 1초 간격 갱신, tabular-nums.
- live dot: breathing 1.6s.
- 숫자 카운터 애니메이션 금지 — 값은 최종값으로 즉시 표시.
