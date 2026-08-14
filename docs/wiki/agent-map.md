# Agent 운영 지도

이 문서는 이름표가 아니라 현재 코드에서 각 Agent가 어떤 실행 방식과 권한으로 동작하는지 보여주는 검증 지도입니다.

마지막 구조 검증일: 2026-08-14

## 의사결정 계층

| 주체 | 형태 | 책임 | 최종 권한 |
|---|---|---|---|
| 병규·CEO | Human | 회사 정책, 비용, 보안, 민감 변경, 외부 공개 예외 | 최종 승인 |
| 루나·`director` | 정책 Agent | 사전 승인 정책 적용, 품질 결과 취합, 예외 분류 | 정책 안의 운영 승인만 가능하며 예외는 CEO에게 요청 |
| 윤아·`qa-auditor` | Hermes + 결정론적 게이트 | 사실성·문체·투자 유의·편집 품질 판정 | 통과·수정·차단 권고만 가능 |

루나는 회사의 최종 의사결정자가 아닙니다. 스케줄러의 자동 승인은 CEO가 미리 허용한 반복 게시 정책을 기계적으로 적용하는 것이며, 비용·보안·정책 변경이나 새 외부 채널은 CEO 예외 승인 대상입니다.

## 주식 블로그 실제 실행 흐름

| 순서 | Agent | 역할 | 기본 실행 방식 | 입력 | 다음 단계 |
|---:|---|---|---|---|---|
| 1 | 서준·`stock-monitor` | 시장 데이터·뉴스·경쟁 글 수집과 사전검증 | 규칙·Provider | 공식 시장 데이터와 검색 결과 | 미나 |
| 2 | 미나·`content-planner` | 주제, 독자, 구조, 근거 사용 계획 | Hermes | ReferenceBundle, MarketSnapshot | 카이 |
| 3 | 카이·`marketing-manager` | 제목, SEO, 경쟁 글 차별화 | Hermes | 기획안, 검색어·경쟁 구조 분석 | 지아 |
| 4 | 지아·`content-writer` | 근거를 재서술해 공개 본문 작성 | Hermes | 기획안, 마케팅안, 실제 기사, 시장 스냅샷 | 윤아 |
| 5 | 윤아·`qa-auditor` | 사실성·문체·구조·유의문구 검수 | Hermes + 규칙 게이트 | 본문과 동일한 ReferenceBundle | 루나 또는 Writer 수정 |
| 6 | 루나·`director` | 정책 내 자동 승인 또는 CEO 예외 분류 | 정책 엔진 | QA 결과, 결정론적 품질 게이트 | 로컬 게시 Agent |
| 7 | `local-naver-draft-agent` | 임시저장과 이중 허용된 guarded publish | Local Playwright | 승인된 NaverDraftJob | 게시 기록 또는 사용자 확인 |

Hermes 네 역할은 논리적으로 분리되어 있지만 같은 Bridge·모델 자원과 기본 동시성 1을 사용해 순차 실행합니다. 공통 오피스 Agent runner의 Mock 시나리오와 주식 블로그 Hermes 파이프라인은 별도 경로이며, 화면의 `실제 실행 방식`에 이 차이를 표시합니다.

레퍼런스가 본문에 반영되는 상세 경로는 [레퍼런스→본문 반영 흐름](reference-to-article-flow.md)에서 확인합니다.

## 공통 직원 Registry

| Agent | 기본 모드 | 운영 범위 |
|---|---|---|
| `director` | policy | 사전 승인 정책 적용과 예외 분류 |
| `content-planner` | hermes, mock 보조 | 주식 블로그 기획, 공통 오피스 시나리오 |
| `marketing-manager` | hermes, mock 보조 | 주식 블로그 마케팅 검토 |
| `content-writer` | hermes, mock 보조 | 주식 블로그 본문 작성 |
| `finance-manager` | mock | Agent 업무 실행은 Mock이며 재정 공급자 조회와 분리 |
| `stock-monitor` | rules/provider, mock 보조 | 시장·레퍼런스 수집과 사전검증 |
| `risk-trader` | rules | 읽기 전용 위험 판단과 Paper Trading |
| `execution-trader` | rules | Paper Trading 체결 시뮬레이션, 실주문 금지 |
| `developer` | mock | 현재 공통 Agent runner의 개발 업무 시뮬레이션 |
| `qa-auditor` | hermes/rules, mock 보조 | 콘텐츠 문맥 검토와 결정론적 품질 차단 |

Registry와 역할 문서의 `agent_id`·표시 이름 일치는 `npm run test:agents`로 검사합니다.

## Workflow 전용 전문 역할

다음 역할 문서는 공통 직원 Registry의 상주 직원이 아니라 특정 Workflow가 호출하는 전문 하위 역할입니다.

- [portfolio-data-collector](../../agents/portfolio-data-collector.md), [portfolio-report-writer](../../agents/portfolio-report-writer.md), [portfolio-qa-auditor](../../agents/portfolio-qa-auditor.md)
- [dividend-monitor](../../agents/dividend-monitor.md), [news-risk-monitor](../../agents/news-risk-monitor.md)

전문 역할을 상주 직원으로 승격할 때만 Registry·좌석·UI 표시를 함께 추가합니다.

## 권한 경계

- 서준은 검증되지 않은 수치나 레퍼런스를 만들어내지 않습니다.
- 미나와 카이는 방향과 차별화를 정하지만 본문 작성이나 게시를 수행하지 않습니다.
- 지아는 제공된 기사와 MarketSnapshot 안에서만 사실을 재서술하고 게시 버튼을 누르지 않습니다.
- 윤아는 통과·수정·차단을 판정하지만 정책·비용·CEO 권한을 바꾸지 않습니다.
- 루나는 정책 안에서 승인 근거를 남기며 예외를 스스로 승인하지 않습니다.
- 로컬 게시 Agent는 서버와 로컬 허용, 이미지·가독성, 중복·카나리 검사를 모두 통과해야 게시할 수 있습니다.
- 민서와 태오는 Paper Trading 전용이며 실계좌 주문과 자금 이동 권한이 없습니다.

## 불일치 해소 기록

| ID | 수정 내용 | 검증 | 상태 |
|---|---|---|---|
| AGENT-GAP-001 | `content-writer`를 공통 Registry에 추가하고 지아 역할 문서 생성 | `test:agents` | resolved |
| AGENT-GAP-002 | CEO를 최종 예외 승인자, 루나를 정책 운영 책임자로 고정 | 역할 문서·운영 지도 | resolved |
| AGENT-GAP-003 | 수동 전용 문구를 guarded auto-publish와 수동 fallback 정책으로 통일 | 운영 문서·Workflow | resolved |
| AGENT-GAP-004 | Hermes·rules·local·mock 실행 방식을 Registry와 직원 상세 화면에 표시 | 타입 검사·build | resolved |
| AGENT-GAP-005 | 개발자 표시 이름을 `하늘`로 통일하고 DB 병합 시 Registry를 우선 | Registry 테스트·UI 검색 | resolved |

## 근거

- [공통 Agent Registry](../../apps/web/src/lib/agents/agent-registry.ts)
- [주식 블로그 Workflow](../../apps/web/src/lib/stock-blog/stock-blog-workflow.ts)
- [콘텐츠 파이프라인](../../apps/web/src/lib/content-pipeline/content-pipeline-service.ts)
- [Hermes Bridge 허용 역할](../../services/hermes-bridge/server.py)
- [주식 블로그 팀 운영](../stock-blog/stock-blog-team-operations.md)
- [운영 규칙](governance.md)
