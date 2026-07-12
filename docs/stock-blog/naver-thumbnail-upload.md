# Naver Thumbnail Upload

BG Company keeps final Naver publishing manual while automating draft preparation through the Local Naver Draft Agent.

## Flow

1. The content pipeline creates the original BG Market Note `1200x675` SVG thumbnail.
2. The Naver Draft Job exposes its same-origin `thumbnailImageUrl` when `NAVER_ALLOW_IMAGE_UPLOAD=true`.
3. The Windows agent downloads only `/generated/stock-blog/` assets from `BG_COMPANY_BASE_URL`.
4. SVG assets are rendered locally to PNG with the existing Playwright browser.
5. The agent moves the editor cursor to the beginning, attaches the thumbnail, and confirms that an image component was added.
6. The agent saves the Naver draft only after title, body readability, and thumbnail attachment checks pass.
7. The user reviews the draft and performs final publishing manually.

## Security

- No Naver password or cookie is sent to the VPS.
- No login, CAPTCHA, or security check is bypassed.
- External image origins and arbitrary filesystem paths are rejected.
- Images larger than 12 MB and unsupported content types are rejected.
- A failed image check stops the job instead of silently saving a text-only draft.
- Naver's publish button is not automated.

## Windows operation

`windows/register-startup-task.ps1` registers `BGCompany-NaverDraftAgent` for the current interactive user. The task starts the agent after Windows logon and writes local logs under `logs/`. Browser login prompts can still appear when Naver requires user verification.
