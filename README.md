# BG Company

AI 직원들의 상태, 업무, 비용, 결과를 한곳에서 관리하는 개인 AI 회사 운영 시스템입니다.

관제 화면, 관리자 인증, 업무·실행·승인 기록, 주식 블로그 파이프라인, Hermes/Codex 콘텐츠 실행 경로, 포트폴리오 기능의 코드가 포함돼 있습니다. 실제 운영 설정과 가동 상태는 소스의 존재와 별도로 확인해야 합니다.

## BG Company 2.0

자율 사업 개발의 첫 기반으로 격리된 PostgreSQL Director와 작업 큐를 추가했습니다. 운영 반영과 Codex Worker 연결은 아직 하지 않았습니다. 조사 결과, 검증 기록과 실행 절차는 [BG Company 2.0 개발 현황](docs/bg-company-v2/README.md)을 참고합니다.

## 프로젝트 구조

- `apps/web`: Next.js 관제 웹 애플리케이션
- `packages/ui`: 공통 UI 패키지
- `packages/shared`: 공통 타입과 유틸리티
- `agents`: 향후 AI 직원 정의
- `config`: 공통 설정
- `docs/wiki`: 역할, 결정, 실패 교훈을 연결하는 BG Company 운영 위키
- `docs/design/phase-1a`: Phase 1-A 디자인 기준 자료
- `docs/product`: 장기 구축계획 참고자료
- `infrastructure`: 인프라 관련 설정
- `scripts`: 개발 및 운영 스크립트

## 로컬 실행

PostgreSQL:

```bash
cp .env.example .env
docker compose up -d
docker compose ps
```

웹 애플리케이션:

```bash
cd apps/web
npm install
npm run dev
```

브라우저에서 `http://localhost:3000`을 엽니다.

## 검증

```bash
cd apps/web
npm run lint
npm run build
```

## 운영 위키

운영 중 확인된 실패, 예방 규칙, 담당 Agent, 주요 결정을 [BG Company 운영 위키](docs/wiki/README.md)에 기록합니다.
같은 원인의 재발은 새 문서를 만들지 않고 기존 교훈의 재발 횟수와 마지막 발생일을 갱신합니다.
