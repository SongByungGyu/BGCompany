# Naver Blog Publish Prep

BG Company Phase 1-C.16 prepares approved or writer-generated content for manual Naver Blog publishing.

The panel is designed for BG Market Note style stock-market briefing posts. It separates the final result into copy-ready blocks so the operator can paste them into Naver Blog without browser automation.

## Scope

- Naver Blog auto login, auto upload, auto save, and auto publish are not implemented.
- The output is prepared for manual copy/paste publishing.
- No Playwright, Selenium, cookie reuse, or browser-login bypass is used.
- No real stock-market API is called in this phase.
- No DB schema change is required; publish prep data is derived from pipeline detail, writerResult, plannerResult, marketingResult, and qaResult.

## Output fields

The publish prep panel should clearly show:

- Naver Blog title
- Intro
- Market summary
- Major index and sector flow
- Key points
- Investor checklist
- Closing comment
- Paste-ready final body
- Markdown
- HTML
- Tags
- Recommended category
- Thumbnail copy
- Thumbnail image prompt
- Inline image ideas
- Investment disclaimer
- Manual publish checklist
- Published URL input

## Generation priority

Publish prep data is derived from existing pipeline data:

1. Title: writerResult.finalTitle -> marketingResult.recommendedTitle -> plannerResult.title -> outputTitle -> pipeline title
2. Summary/body source: writerResult -> plannerResult -> marketingResult -> pipeline summary/topic
3. Tags: writerResult.usedSeoKeywords -> marketingResult.seoKeywords -> plannerResult.seoKeywords -> template defaults
4. Category: inferred stock briefing template
5. Thumbnail text: marketingResult.thumbnailCopy -> template default

## Body versions

The panel provides three body versions.

### pasteReadyBody

- Plain text optimized for Naver Blog editor paste
- No heavy HTML
- Includes intro, market summary, index/sector flow, key points, investor checklist, closing comment, and disclaimer

### markdownBody

- Structured Markdown
- Includes headings and bullet lists
- Includes disclaimer at the bottom

### htmlBody

- Minimal safe HTML generated from Markdown
- Uses only simple structural tags such as h1, h2, p, br, and hr
- Does not include script, iframe, style, onclick, or tracking pixels

## Manual publish checklist

- 네이버 블로그 제목 붙여넣기
- 본문 붙여넣기
- 태그 입력
- 카테고리 선택
- 썸네일 이미지 업로드
- 투자 유의문구 확인
- 미리보기 확인
- 임시저장 또는 발행 직접 진행
- 게시 URL 기록

## Copy buttons

The panel provides copy buttons for:

- title
- paste-ready body
- Markdown
- HTML
- tags
- thumbnail copy
- image prompts
- disclaimer

Successful copy shows `복사 완료`. If browser clipboard access is blocked, the UI asks the operator to copy manually.

## Prohibited actions

- Naver login cookie bypass
- Naver auto posting
- Playwright/Selenium publishing
- WordPress publishing
- live stock API calls
- buy/sell recommendation wording
- guaranteed return wording
- arbitrary real index numbers
