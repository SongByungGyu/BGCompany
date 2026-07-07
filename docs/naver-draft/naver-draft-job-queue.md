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
