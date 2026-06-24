# BG Company

AI 직원들의 상태, 업무, 비용, 결과를 한곳에서 관리하는 개인 AI 회사 운영 시스템입니다.

현재 범위는 Phase 1-A 관제 화면의 기본 골격과 로컬 개발 환경입니다. 실제 3D 사무실, 외부 API, 자동 게시, 인증, Hermes 연동은 이번 단계에 포함하지 않습니다.

## 프로젝트 구조

- `apps/web`: Next.js 관제 웹 애플리케이션
- `packages/ui`: 공통 UI 패키지
- `packages/shared`: 공통 타입과 유틸리티
- `agents`: 향후 AI 직원 정의
- `config`: 공통 설정
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

