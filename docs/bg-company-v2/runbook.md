# BG Company 2.0 격리 환경 실행과 복구 절차

이 절차는 개발 환경과 테스트에만 적용한다. 기존 운영 Compose, PostgreSQL 볼륨, cron, 인증 정보를 바꾸지 않는다. 운영 공개와 결제 활성화는 별도 승인 대상이다.

## 먼저 확인할 조건

Node.js 22.18 이상 또는 24, npm과 PostgreSQL 17이 필요하다. Docker를 사용할 경우 별도 테스트 Compose를 사용한다. 새 기능은 `BG_V2_ENABLED=false`가 기본값이다.

`BG_V2_DATABASE_URL`은 별도 `bg_company_v2_dev`, `bg_company_v2_test`, `bg_company_v2_staging` DB를 가리켜야 한다. 기존 운영 DB URL로 대체하거나 seed를 실행하지 않는다. 비밀 값은 환경에만 설정하고 Git, 보고서, 작업 입력에 넣지 않는다.

## 재현 가능한 Docker 검증

저장소 루트에서 실행한다.

```bash
docker compose -f infrastructure/bg-company-v2/compose.test.yml config --quiet
docker compose -f infrastructure/bg-company-v2/compose.test.yml up --build --abort-on-container-exit --exit-code-from tests
docker compose -f infrastructure/bg-company-v2/compose.test.yml down
```

테스트 DB는 tmpfs에 저장하며 종료 시 사라진다. 운영 볼륨을 연결하지 않는다. Compose 이름은 `bg-company-v2-test`이고 호스트 포트를 열지 않는다. 테스트 서비스의 네트워크는 내부 전용이며 Docker socket과 실제 인증 파일을 마운트하지 않는다.

## 별도 개발 DB 초기화

별도 개발 DB와 최소 권한 사용자 연결이 먼저 준비돼 있어야 한다. 다음 명령은 해당 DB 안의 스키마와 테이블만 추가한다.

```bash
npm --prefix apps/web ci --ignore-scripts --no-audit --no-fund
BG_V2_ALLOW_SCHEMA_CREATE=true node --experimental-strip-types scripts/bg-v2-control.mjs init
node --experimental-strip-types scripts/bg-v2-control.mjs status
node --experimental-strip-types scripts/bg-v2-control.mjs start initial-bg-v2 "BG Company 2.0"
```

연결 값은 이미 `BG_V2_DATABASE_URL` 환경변수에 안전하게 설정돼 있다고 가정한다. 명령 예시에 비밀번호를 직접 넣지 않는다.

프로젝트를 시작하면 6개 단계의 작업을 저장하지만 실행기를 시작하지는 않는다. 사용량 상태는 기본적으로 `unknown`이라 실행권을 발급하지 않는다. 테스트를 제외하고 검증되지 않은 가용성 값을 기록하면 안 된다.

## API 사용 조건

개발 웹 프로세스에서만 `BG_V2_ENABLED=true`와 별도 DB 연결을 설정한다. 역방향 프록시를 통과한다면 `BG_V2_CONTROL_ORIGIN`을 실제 관리 화면의 정확한 출처로 설정한다. 경로와 마지막 슬래시는 붙이지 않는다.

- `GET /api/business-development`: 관리자 세션으로 프로젝트·작업·시도·사용량 상태 조회.
- `POST /api/business-development`: 같은 출처의 JSON으로 `start`, `pause`, `resume`, `enqueue`, `retry_interrupted` 요청.
- 실행권, 완료 보고, 가용성 갱신과 프로세스 종료 확인은 신뢰하는 Worker 내부 인터페이스다. 공개 HTTP 경로를 제공하지 않는다.
- 승인 해제, 유료 호출, 결제 활성화, 실제 배포 명령을 실행하는 API는 없다.

`trial_deploy`는 향후 격리된 시험 배포 실행기에만 연결한다. 공개 서비스 반영은 `public_release`로 구분하고 승인 없이 실행하지 않는다. HTTP 관리 기능은 이번 단계에 UI로 연결하지 않았다.

## Worker 구현 시 지켜야 할 실행 계약

1. 새 실행권을 받은 뒤 별도 작업 공간이나 격리 컨테이너에서 실행한다.
2. 정기 heartbeat가 false이면 즉시 하위 프로세스에 중단을 요청한다.
3. 하위 프로세스 또는 컨테이너의 종료를 실제 확인한 뒤에만 `finish`를 호출한다.
4. 이미 만료된 실행권이라 완료 처리가 거절되면, 프로세스 종료 후 원래 토큰으로 `confirmStopped`를 호출한다.
5. `retryInterrupted`는 종료 확인이 저장된 작업에만 적용된다. 살아 있는 작업을 새 토큰으로 재실행하지 않는다.
6. 사용량 오류는 `blocked_usage`로 완료 처리한다. 검증된 새 가용성 관측이 오기 전에는 다시 열지 않는다.
7. 토큰 수와 실제 청구액을 얻지 못하면 비워둔다. 구독 호출 비용을 임의로 0원 또는 API 단가로 환산하지 않는다.

실행권은 결과를 DB에 기록할 권한을 제한하지만 외부 프로세스 자체를 종료시키지는 않는다. 프로세스 감독기는 다음 구현 작업이다. 작업 서버가 완전히 사라져 종료 증명을 얻지 못한 경우 자동으로 재실행하지 않고 운영 조사까지 중단 상태를 유지한다.

## VPS 읽기 전용 조사

접근 가능한 VPS의 실제 저장소 경로에서 다음을 실행한다.

```bash
python3 scripts/bg-v2-audit.py --repo /actual/bg-company/path
```

스크립트는 Git, 자원, 선택한 Docker 메타데이터, cron 일정과 명령 해시, DB 테이블 메타데이터, 백업 파일 수를 조회한다. 운영 로그, `.env`, DB 행 원문을 반환하지 않는다. DB 조회는 READ ONLY 트랜잭션이다. 명령 실패의 원문 출력도 숨긴다.

이 결과만으로 데이터 무결성이나 백업 복원 성공을 주장할 수 없다. 이미지 revision 정보가 없으면 소스와 배포 버전 일치도 미확인이다. 이 스크립트를 현재 Work 환경에서 실행한 결과는 VPS 조사 결과로 취급하지 않는다.

## 롤백

새 기능을 비활성화하고 신규 Worker만 중지한다. 새 큐의 실행 기록과 DB를 보존한 채 검증된 이전 애플리케이션 커밋으로 되돌린다. 기존 운영 Compose와 DB는 이번 변경에 포함되지 않으므로 그대로 유지한다.

운영 환경에는 아직 이 기능을 반영하지 않았다. 향후 운영 반영 시 백업 검증, 이미지 커밋 표시, 이전 이미지 보관과 건강검사 기준을 먼저 준비한다. DB와 Docker 볼륨 삭제, seed 재실행, 운영 스키마 강제 동기화는 롤백 절차에 포함하지 않는다.
