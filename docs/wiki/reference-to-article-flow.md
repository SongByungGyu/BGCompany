# 레퍼런스→본문 반영 흐름

결론부터 말하면 Reference는 수집만 하는 보관함이 아닙니다. 주제 선택, 글 구조, 제목 차별화, 본문 사실 주장, 출처 섹션, QA와 최종 게시 차단까지 같은 근거 묶음이 이어집니다.

마지막 코드 검증일: 2026-08-14

## 전체 흐름

```text
검색·공식 시장 Provider
  → ReferenceBundle 정규화
  → Hermes 실행 전 사전검증
  → Planner 구조·근거 계획
  → Marketing 검색 의도·차별화
  → Writer 기사 사실 재서술·시장 해석·출처 3개
  → QA가 동일 근거로 대조
  → 결정론적 품질 게이트
  → 정책 승인과 Naver 게시 작업
```

## 단계별 반영

| 단계 | Reference 사용 방식 | 실패 시 |
|---|---|---|
| 수집 | 설정된 Provider가 뉴스, 경쟁 블로그, 공식 시장 데이터를 모아 `ReferenceBundle`로 정규화 | provider 상태와 누락 항목 기록 |
| 사전검증 | 실제 자료 5개, 고유 URL 5개, 발행처 3곳, 뉴스 3개, 경쟁 글 3개, 검증되고 최신인 MarketSnapshot 확인 | Hermes 실행 전 `STOCK_REFERENCE_PREFLIGHT_BLOCKED`로 안전 정지 |
| Planner | 전체 ReferenceBundle과 MarketSnapshot으로 주제·독자·본문 구조·근거 계획 수립 | 근거 부족 결과를 작성하지 않음 |
| Marketing | 검색어, 경쟁 글 구조 분석, 차별화 포인트를 제목·SEO·도입 전략에 반영 | 근거 없는 과장·복제 금지 |
| Writer | 실제 기사 요약 최대 10개와 MarketSnapshot을 입력받아 핵심 사실을 자기 문장으로 재서술 | 입력에 없는 일정·수치·기사 생성 금지 |
| 공개 출처 | 실제 활용한 기사 정확히 3개를 마지막 `함께 확인한 기사`에 제목·언론사·발행일·원문 링크로 표기 | 개수·링크 위치가 다르면 차단 |
| QA | Writer 본문과 같은 실제 기사·MarketSnapshot을 대조해 사실성, 표현, 구조, 투자 유의문구를 검사 | 수정 피드백 후 Writer 재작성 또는 게시 차단 |
| 최종 게이트 | Reference 수·발행처·시장 데이터 최신성, 본문 길이·구조·출처 3개·중복·Mock 노출을 다시 결정론적으로 검사 | 자동 승인과 게시 작업 생성 차단 |

## 글에 보이는 변화

- 시장 수치와 일정은 검증된 MarketSnapshot 값만 사용합니다.
- 기사 사실은 원문을 복사하지 않고 최근 움직임의 이유와 이어질 영향을 설명하는 문장으로 재서술합니다.
- 경쟁 블로그는 문장을 가져오는 자료가 아니라 검색 의도, 평균 구조, 빠진 설명을 찾아 차별화하는 자료로 씁니다.
- 글 하단에는 실제 본문에서 사용한 기사 3개만 공개 링크로 남깁니다.
- 기사나 데이터가 부족하면 빈칸을 상상으로 채우지 않고 파이프라인을 멈춥니다.

## 현재 추적 가능한 범위

현재는 전체 `ReferenceBundle`이 파이프라인 메타데이터에 보존되고, 최종 글에는 활용 기사 3개가 공개됩니다. 따라서 어떤 근거 묶음으로 글을 만들었는지와 공개한 출처는 확인할 수 있습니다.

다만 Writer 출력에는 `usedReferenceIds`나 문장별 `claim → source` 매핑이 없습니다. 즉, 특정 문장이 어느 기사 항목에서 나왔는지까지 자동 감사하는 수준은 아닙니다. 현재 QA는 동일한 기사 요약과 시장 스냅샷을 다시 읽어 대조하고, 최종 규칙 게이트는 개수·URL·시장 데이터 상태를 검사합니다.

다음 개선 우선순위는 Writer JSON에 사용 레퍼런스 식별자를 저장하고, 핵심 수치·사건 문장에 `claimSourceMap`을 붙인 뒤 QA가 해당 매핑을 결정론적으로 검증하는 것입니다.

## 코드 근거

- [Reference Provider 선택](../../apps/web/src/lib/stock-blog/references/reference-adapter.ts)
- [ReferenceBundle 타입](../../apps/web/src/lib/stock-blog/references/reference-types.ts)
- [파이프라인 전달과 사전검증](../../apps/web/src/lib/content-pipeline/content-pipeline-service.ts)
- [Hermes 역할별 입력](../../apps/web/src/lib/hermes/hermes-client.ts)
- [Writer·QA 프롬프트](../../services/hermes-bridge/server.py)
- [최종 품질 게이트](../../apps/web/src/lib/stock-blog/quality-gate.ts)
- [Naver 게시 작업 조립](../../apps/web/src/lib/naver-drafts/naver-draft-jobs.ts)
