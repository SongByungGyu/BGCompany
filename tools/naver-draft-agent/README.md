# BG Company Naver Draft Agent

Local-only agent for preparing Naver Blog drafts from BG Company `NaverDraftJob` records.

## Safety policy

- Default is dry-run: `NAVER_AGENT_DRY_RUN=true`.
- Publishing is off by default; a click is possible only through the guarded automatic publishing policy below.
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
NAVER_AGENT_SINGLETON_PORT=43923
NAVER_AGENT_STATE_FILE=./logs/naver-draft-agent-state.json
NAVER_AGENT_DEPLOY_HOLD_FILE=./logs/naver-agent-deployment.hold
NAVER_AGENT_DRY_RUN=true
NAVER_ALLOW_DRAFT_SAVE=false
```

## 0-stage operation

1. BG Company creates a Naver draft job after policy approval or an approved CEO exception.
2. This local agent polls `/api/local-agents/naver-drafts/next`.
3. It claims the job and writes a local JSON file under `drafts/`.
4. In dry-run mode it reports `draft_saved` with a `dry-run://` URL.
5. In non-dry-run mode it opens a local Chromium profile and fills Naver Blog fields where possible.
6. The job either stops for user verification/manual publishing or enters guarded automatic publishing when every opt-in and server gate passes.
7. Scheduled jobs are claimed only inside the configured lead window. The agent can prepare the editor early, sends a 30-second heartbeat while waiting, and cannot pass the server publish gate before `publishNotBefore`.

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

Run this command directly from the agent terminal. Do not wrap it in a persistent `powershell -NoExit` launcher. The reviewed installer detects and closes a leftover agent-owned login setup shell or dedicated-profile browser only after the server confirms that no Naver job is publishing.

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

Login, security verification, CAPTCHA, image upload, draft save, and publish errors stop the job. Authentication recovery uses the same cause job and must pass two editor-ready probes at least one second apart under the same server lease. The agent never retries a publish click automatically and never uploads the persistent browser profile or cookie/storage values.

Pre-publish editor/image failures are re-queued by the server under the same job and publish key. A stale `image_uploading`, `draft_saving`, or `publish_ready` job is reclaimed after the claim timeout; terminal jobs are never reclaimed. Each claim has a process-unique agent ID and stable `claimedAt` lease token. Every status transition uses both values, and the server rejects old agents that do not declare lease protocol version 2.

`publishing` is never reclaimed. If its heartbeat becomes stale, the server records an uncertain global publish circuit and blocks every later automatic publish until the original result is safely resolved. Partial, blank, or invalid schedule fields fail closed; fully unscheduled manual jobs remain immediate.

## Reviewed Windows rollout

The production package must be built and manifested on the target Windows host. Run these from the reviewed `tools/naver-draft-agent` source directory:

```powershell
npm ci
npm run build
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\windows\write-runtime-manifest.ps1 -AgentRoot (Resolve-Path .) -BuildSha <reviewed-git-sha>
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\windows\install-reviewed-agent.ps1 -SourceRoot (Resolve-Path .) -InstallRoot "D:\BG Company\runtime\bg-company\naver-draft-agent-windows" -Activate
```

Roll out the web lease-protocol gate only while the database has no active or `publishing` Naver job. An old agent then receives `NAVER_DRAFT_LEASE_PROTOCOL_UPGRADE_REQUIRED` instead of claiming new work. The installer independently calls the authenticated runtime-status endpoint and fails closed unless both server counts are zero.

For an online replacement, the installer creates a local deployment hold and waits for the running agent to acknowledge it before capturing exact process instances and stopping the task. A live legacy process that cannot acknowledge the hold is never interrupted, even with `-ConfirmLegacyNoPublishing`; stop and drain that legacy runtime separately first.

Activation is accepted only after fresh supervisor and agent-state records match the exact root, singleton port, Git build SHA, runtime SHA, absolute Node executable, and listener PID. The active runtime, browser profile, secrets, and retained backup all receive protected ACLs limited to the current user, SYSTEM, and Administrators. Any failure after the directory swap stops only the captured process instances, restores the previous runtime and task XML/state, and retains the failed candidate for diagnosis. Do not delete the retained backup until at least one scheduled cycle has completed successfully.
