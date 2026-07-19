# BG Company Naver Draft Agent

Local-only agent for preparing Naver Blog drafts from BG Company `NaverDraftJob` records.

## Safety policy

- Default is dry-run: `NAVER_AGENT_DRY_RUN=true`.
- The agent never clicks the Naver publish button.
- Naver ID/password are not stored by BG Company.
- Naver cookies are kept only in the local browser profile directory.
- Captcha, 2FA, login, and security screens require manual user action.
- Draft save is disabled unless `NAVER_ALLOW_DRAFT_SAVE=true`.

## Setup

```bash
cd tools/naver-draft-agent
cp .env.example .env
npm install
npm run build
npm start
```

Required `.env` values:

```env
BG_COMPANY_BASE_URL=https://bgcompanyoffice.cloud
NAVER_DRAFT_AGENT_KEY=...
NAVER_AGENT_DRY_RUN=true
NAVER_ALLOW_DRAFT_SAVE=false
```

## 0-stage operation

1. BG Company creates a Naver draft job after Director approval.
2. This local agent polls `/api/local-agents/naver-drafts/next`.
3. It claims the job and writes a local JSON file under `drafts/`.
4. In dry-run mode it reports `draft_saved` with a `dry-run://` URL.
5. In non-dry-run mode it opens a local Chromium profile and fills Naver Blog fields where possible.
6. The user verifies and publishes manually.

## Browser troubleshooting

- If the Playwright browser opens as a tiny grey WSLg window, set `NAVER_BROWSER_CHANNEL=chrome` when Chrome is installed inside WSL.
- If Chrome is only installed on Windows, set `NAVER_BROWSER_EXECUTABLE_PATH` to the Chrome executable path and keep `NAVER_BROWSER_CHANNEL` empty.
- When Naver login/security appears, complete it manually in the opened browser and press Enter in the agent terminal.

- If WSLg Chromium is not visible, launch a normal Windows Chrome with remote debugging and set `NAVER_CDP_ENDPOINT=http://127.0.0.1:9222`.

## Manual login session setup

Use the dedicated local-only setup mode before running the normal agent when Naver requests login, 2FA, captcha, or a security check:

```bash
npm run login:setup
```

This mode uses the existing `NAVER_BROWSER_PROFILE_DIR`, opens a visible sandboxed Chrome window, and waits for the user to finish the login and security steps manually. It does not poll the BG Company API, inspect or claim draft jobs, fill editor fields, click draft-save, or publish. It never prints or uploads browser cookies or storage. After reaching the BG Market Note write or management screen, return to the terminal and press Enter. The command closes the browser normally and prints only `NAVER_SESSION_STATUS=...`.

Stop the normal agent and every Chrome process using the same profile before setup. Never delete `.naver-profile` to resolve a profile lock.


## Recommended safe workflow

1. Keep dry-run enabled first: `NAVER_AGENT_DRY_RUN=true`.
2. Verify browser launch only: `npm run browser:test`.
3. Log in to Naver manually in the opened local browser if required.
4. Only after browser/login are stable, set `NAVER_AGENT_DRY_RUN=false` for a single manual live test.
5. Keep `NAVER_ALLOW_DRAFT_SAVE=false` unless you explicitly want the agent to click a draft-save button.

The live writer is experimental because Naver may require login, captcha, or security verification. If that happens, stop the agent and use the BG Company publish-prep copy buttons for manual posting.

## Guarded automatic publishing

Publishing is off by default. A publish click is possible only when all of the following are true:

- `NAVER_AGENT_DRY_RUN=false`
- `NAVER_ALLOW_DRAFT_SAVE=true`
- `NAVER_ALLOW_IMAGE_UPLOAD=true`
- `NAVER_ALLOW_PUBLISH=true`
- the claimed job contains `allowPublish=true`
- image upload, editor readability, draft save, and the server-side final duplicate/canary check all pass

Login, security verification, CAPTCHA, image upload, draft save, and publish errors stop the job. The agent never retries a publish click automatically and never uploads the persistent browser profile or cookie/storage values.
