# Naver Draft Job Queue

## Model

`NaverDraftJob` stores a Naver Blog draft preparation request.

Important fields:

- `contentPipelineId`: source content pipeline.
- `approvalId`: Director approval used for readiness check.
- `status`: queue lifecycle status.
- `title`, `body`, `markdownBody`, `htmlBody`: draft payload.
- `tags`, `category`, `thumbnailText`, `thumbnailPrompt`, `disclaimer`: Naver Blog prep metadata.
- `claimedBy`, `claimedAt`, `startedAt`, `completedAt`: local agent lifecycle timestamps.
- `externalUrl`, `errorCode`, `errorMessage`: result reporting.

## Admin APIs

Session-protected endpoints:

```text
POST /api/naver-drafts/jobs
GET /api/naver-drafts/jobs
GET /api/naver-drafts/jobs/:jobId
POST /api/naver-drafts/jobs/:jobId/cancel
```

Draft jobs are created only for approved or ready-to-publish content by default.

## Local Agent APIs

Header-protected endpoints:

```http
x-naver-draft-agent-key: <NAVER_DRAFT_AGENT_KEY>
```

```text
GET /api/local-agents/naver-drafts/next
POST /api/local-agents/naver-drafts/:jobId/claim
POST /api/local-agents/naver-drafts/:jobId/status
```

## Operational notes

- `NAVER_DRAFT_MAX_CLAIM_MINUTES` controls stale claim recovery.
- Default poll interval is 30 seconds.
- Jobs can be cancelled from the admin UI before completion.
- `docker compose down -v`, DB reset, and seed reruns are not part of this flow.

## Deployment note

This feature adds a Prisma model. Before production use, apply the DB schema change deliberately after backup:

```bash
npm --prefix apps/web run db:push
```

Do not run seed automatically.

## Approval-free draft queue option

운영자가 네이버 블로그 발행 버튼은 직접 누르되, BG Company가 승인 단계 없이 네이버 임시저장 작업까지 자동으로 준비하게 하려면 서버 `.env`에서 아래 값을 사용한다.

```env
NAVER_DRAFT_REQUIRE_APPROVAL=false
NAVER_DRAFT_AUTO_AFTER_QA=true
```

이 설정은 네이버 로그인 정보나 쿠키를 서버에 저장하지 않는다. Local Naver Draft Agent는 로컬 PC에서 글쓰기 화면 입력과 임시저장까지만 수행해야 하며, 발행은 사용자가 네이버 화면에서 직접 확인 후 진행한다.