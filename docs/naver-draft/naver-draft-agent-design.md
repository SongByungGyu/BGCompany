# Naver Draft Agent Design

BG Company Phase 1-S.3 introduces a local-only Naver Blog draft agent.

## Goal

BG Company creates a `NaverDraftJob` from an approved content pipeline. A local PC agent polls the job queue, prepares a Naver Blog draft, and reports status back to BG Company.

## Non-goals

- No automatic Naver publishing.
- No Naver credential storage.
- No cookie upload to BG Company.
- No captcha, 2FA, or security bypass.
- No Playwright browser running on the VPS.
- No stock API or Hermes automatic execution as part of draft creation.

## Architecture

```text
BG Company web/API
  -> NaverDraftJob DB queue
  -> Local Agent API secured by x-naver-draft-agent-key
  -> User PC Local Draft Agent
  -> Local browser profile
  -> Naver Blog write page
  -> User manual verification/publish
```

## Local agent safety defaults

```env
NAVER_AGENT_DRY_RUN=true
NAVER_ALLOW_DRAFT_SAVE=false
```

Dry-run stores the job payload in `tools/naver-draft-agent/drafts/` and reports a non-publishing status. Real browser automation must be explicitly enabled locally.

## Status flow

```text
queued -> claimed -> in_progress -> draft_saved
queued -> claimed -> in_progress -> user_publish_required
queued -> claimed -> in_progress -> failed
queued -> cancelled
```

`user_publish_required` means the local browser needs manual login/security verification or final user confirmation.

## Security boundaries

- `NAVER_DRAFT_AGENT_KEY` authenticates the local agent to BG Company.
- The key is not the OpenAI key and not a Naver credential.
- The local browser profile remains on the user PC.
- BG Company stores only job payload/status, not Naver sessions.
