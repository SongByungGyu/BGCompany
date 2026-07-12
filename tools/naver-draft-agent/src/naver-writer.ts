import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export type NaverDraftJob = {
  id: string;
  title: string;
  body: string;
  markdownBody: string | null;
  htmlBody: string | null;
  tags: string[];
  category: string | null;
  thumbnailText: string | null;
  thumbnailPrompt: string | null;
  thumbnailTitle?: string | null;
  thumbnailSubtitle?: string | null;
  thumbnailHook?: string | null;
  thumbnailStyle?: string | null;
  thumbnailImageUrl?: string | null;
  thumbnailTemplateType?: string | null;
  thumbnailPrimaryText?: string | null;
  thumbnailSecondaryText?: string | null;
  thumbnailKeywords?: string[];
  inlineImageUrls?: string[];
  imageStatus?: string | null;
  references?: Array<{ title?: string; sourceName?: string; originalUrl?: string; url?: string }>;
  competitorBlogReferences?: Array<{ title?: string; blogName?: string; url?: string }>;
  allowImageUpload?: boolean;
  disclaimer: string | null;
};

type WriterResult = {
  status: "draft_saved" | "user_publish_required" | "failed" | "login_required" | "captcha_required" | "security_check_required" | "readability_failed";
  externalUrl?: string;
  errorCode?: string;
  errorMessage?: string;
};

const openBrowserContexts = new Set<unknown>();
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/svg+xml"]);

function classifySecurityPage(url: string, text: string): WriterResult["status"] | null {
  const haystack = `${url}\n${text}`.toLowerCase();
  if (["captcha", "\uc790\ub3d9\uc785\ub825", "\ub85c\ubd07"].some((token) => haystack.includes(token))) return "captcha_required";
  if (["2fa", "two-factor", "\ubcf4\uc548", "security", "\uc778\uc99d"].some((token) => haystack.includes(token))) return "security_check_required";
  if (["login", "\ub85c\uadf8\uc778", "signin", "sign in"].some((token) => haystack.includes(token))) return "login_required";
  return null;
}



function isExplicitLiveMode() {
  const setting = process.env.NAVER_AGENT_DRY_RUN ?? process.env.NAVER_DRAFT_AGENT_DRY_RUN;
  return setting === "false";
}

function describeBrowserConfig(profileDir: string, browserChannel?: string, browserExecutablePath?: string, cdpEndpoint?: string) {
  return [
    `profile=${profileDir}`,
    `channel=${browserChannel || "bundled"}`,
    `executable=${browserExecutablePath ? "set" : "unset"}`,
    `cdp=${cdpEndpoint || "unset"}`,
  ].join(", ");
}

async function launchPersistentBrowserContext(
  chromium: typeof import("playwright").chromium,
  profileDir: string,
  browserChannel?: string,
  browserExecutablePath?: string,
) {
  const launchArgs = ["--start-maximized", "--window-position=80,80", "--window-size=1440,900"];
  const launchOptions = {
    headless: false,
    viewport: null,
    chromiumSandbox: true,
    timeout: 20000,
    ...(browserChannel ? { channel: browserChannel } : {}),
    ...(browserExecutablePath ? { executablePath: browserExecutablePath } : {}),
    args: launchArgs,
  };

  try {
    return await chromium.launchPersistentContext(profileDir, launchOptions);
  } catch (error) {
    if (!browserChannel && !browserExecutablePath) throw error;
    console.warn("[naver-agent] configured browser failed; retrying with bundled Playwright Chromium.");
    console.warn(`[naver-agent] browser fallback reason: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`);
    return chromium.launchPersistentContext(profileDir, {
      headless: false,
      viewport: null,
      chromiumSandbox: true,
      timeout: 20000,
      args: launchArgs,
    });
  }
}

async function waitForManualNaverVerification(status: WriterResult["status"], url: string) {
  if (process.env.NAVER_WAIT_FOR_SECURITY === "false") return false;
  if (!stdin.isTTY) return false;

  console.log(`[naver-agent] ${status}: Naver login/security verification is required.`);
  console.log(`[naver-agent] Open browser URL: ${url}`);
  console.log("[naver-agent] Complete Naver login/security check in the opened browser, then press Enter here to retry.");
  console.log("[naver-agent] Type 'skip' and press Enter to stop waiting.");

  const rl = createInterface({ input: stdin, output: stdout });
  try {
    const answer = await rl.question("[naver-agent] Press Enter after Naver verification> ");
    return answer.trim().toLowerCase() !== "skip";
  } finally {
    rl.close();
  }
}

async function detectBlockedStatus(page: { url: () => string; locator: (selector: string) => { innerText: (options?: { timeout?: number }) => Promise<string> } }) {
  const bodyText = await page.locator("body").innerText({ timeout: 10000 }).catch(() => "");
  return classifySecurityPage(page.url(), bodyText);
}

function normalizeEditorText(value: string) {
  return value
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function readabilityMetrics(value: string) {
  const normalized = value.replace(/\r\n/g, "\n").trim();
  return {
    characterCount: normalized.replace(/\s/g, "").length,
    lineCount: normalized.split("\n").map((line) => line.trim()).filter(Boolean).length,
    paragraphCount: normalized.split(/\n{2,}/).map((item) => item.trim()).filter(Boolean).length,
  };
}

async function readNaverEditorText(page: import("playwright").Page) {
  const selectors = [
    ".se-main-container",
    ".se-component-content",
    '[contenteditable="true"][aria-label*="본문"]',
    '[contenteditable="true"][data-placeholder*="내용"]',
  ];
  for (const scope of [page, ...page.frames()]) {
    for (const selector of selectors) {
      const target = scope.locator(selector).first();
      if (!(await target.count().catch(() => 0))) continue;
      const text = await target.innerText({ timeout: 5000 }).catch(() => "");
      if (text.trim()) return text;
    }
  }
  return "";
}

async function verifyNaverEditorReadability(page: import("playwright").Page, expectedBody: string) {
  await page.waitForTimeout(1200);
  const expected = readabilityMetrics(expectedBody);
  const actualText = await readNaverEditorText(page);
  const actual = readabilityMetrics(actualText);
  const minimumCharacters = Math.min(500, Math.max(120, Math.floor(expected.characterCount * 0.35)));
  const minimumLines = Math.min(8, Math.max(3, Math.floor(expected.lineCount * 0.4)));
  const ok = actual.characterCount >= minimumCharacters && actual.lineCount >= minimumLines;
  console.log(`[naver-agent] readability check: chars=${actual.characterCount}/${expected.characterCount}, lines=${actual.lineCount}/${expected.lineCount}, paragraphs=${actual.paragraphCount}/${expected.paragraphCount}`);
  return { ok, expected, actual };
}

function safeFileSegment(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 100) || "naver-draft";
}

function resolveTrustedAssetUrl(value: string, assetBaseUrl: string) {
  const base = new URL(assetBaseUrl);
  const url = new URL(value, base);
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("NAVER_IMAGE_URL_PROTOCOL_NOT_ALLOWED");
  if (url.origin !== base.origin) throw new Error("NAVER_IMAGE_URL_ORIGIN_NOT_ALLOWED");
  if (!url.pathname.startsWith("/generated/stock-blog/")) throw new Error("NAVER_IMAGE_URL_PATH_NOT_ALLOWED");
  return url;
}

async function downloadTrustedThumbnail(input: {
  page: import("playwright").Page;
  jobId: string;
  imageUrl: string;
  assetBaseUrl: string;
}) {
  const url = resolveTrustedAssetUrl(input.imageUrl, input.assetBaseUrl);
  const response = await fetch(url, { redirect: "error" });
  if (!response.ok) throw new Error(`NAVER_IMAGE_DOWNLOAD_FAILED_${response.status}`);
  const contentType = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (!ALLOWED_IMAGE_TYPES.has(contentType)) throw new Error(`NAVER_IMAGE_TYPE_NOT_ALLOWED_${contentType || "unknown"}`);
  const contentLength = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > MAX_IMAGE_BYTES) throw new Error("NAVER_IMAGE_TOO_LARGE");
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.byteLength === 0 || buffer.byteLength > MAX_IMAGE_BYTES) throw new Error("NAVER_IMAGE_SIZE_INVALID");

  const outputDir = path.resolve("drafts", "assets", safeFileSegment(input.jobId));
  await mkdir(outputDir, { recursive: true });
  if (contentType !== "image/svg+xml") {
    const extension = contentType === "image/jpeg" ? "jpg" : contentType === "image/webp" ? "webp" : "png";
    const outputFile = path.join(outputDir, `thumbnail.${extension}`);
    await writeFile(outputFile, buffer);
    console.log(`[naver-agent] thumbnail downloaded: ${url.pathname}`);
    return outputFile;
  }

  const svg = buffer.toString("utf8");
  if (!svg.includes("<svg")) throw new Error("NAVER_SVG_INVALID");
  const renderPage = await input.page.context().newPage();
  const outputFile = path.join(outputDir, "thumbnail.png");
  try {
    await renderPage.setViewportSize({ width: 1200, height: 675 });
    const encoded = buffer.toString("base64");
    await renderPage.setContent(
      `<html><head><style>html,body{margin:0;width:1200px;height:675px;overflow:hidden;background:#071426}img{display:block;width:1200px;height:675px}</style></head><body><img src="data:image/svg+xml;base64,${encoded}" /></body></html>`,
      { waitUntil: "load", timeout: 20000 },
    );
    await renderPage.locator("img").waitFor({ state: "visible", timeout: 10000 });
    await renderPage.screenshot({ path: outputFile, type: "png", fullPage: false });
  } finally {
    await renderPage.close().catch(() => undefined);
  }
  console.log(`[naver-agent] thumbnail converted to PNG: ${url.pathname}`);
  return outputFile;
}

async function countNaverImages(page: import("playwright").Page) {
  const selectors = [".se-component-image", ".se-image", "img.se-image-resource", ".se-main-container img"];
  let count = 0;
  for (const scope of [page, ...page.frames()]) {
    for (const selector of selectors) count = Math.max(count, await scope.locator(selector).count().catch(() => 0));
  }
  return count;
}

async function focusEditorStart(page: import("playwright").Page, selectors: string[]) {
  for (const scope of [page, ...page.frames()]) {
    for (const selector of selectors) {
      const target = scope.locator(selector).first();
      if (!(await target.count().catch(() => 0))) continue;
      await target.click({ timeout: 5000 }).catch(() => undefined);
      await page.keyboard.press(process.platform === "darwin" ? "Meta+Home" : "Control+Home").catch(() => undefined);
      return;
    }
  }
}

async function uploadNaverThumbnail(page: import("playwright").Page, bodySelectors: string[], imageFile: string) {
  await dismissNaverDraftModal(page).catch(() => undefined);
  await focusEditorStart(page, bodySelectors);
  const before = await countNaverImages(page);
  const fileInputs = page.locator('input[type="file"][accept*="image"], input[type="file"][multiple]');
  if (await fileInputs.count().catch(() => 0)) {
    await fileInputs.first().setInputFiles(imageFile, { timeout: 10000 });
    console.log("[naver-agent] thumbnail selected through Naver image input.");
  } else {
    const selectors = [
      'button:has-text("사진")',
      'a:has-text("사진")',
      '[role="button"]:has-text("사진")',
      'button[class*="image"]',
      'a[class*="image"]',
    ];
    let selected = false;
    for (const selector of selectors) {
      const button = page.locator(selector).first();
      if (!(await button.count().catch(() => 0))) continue;
      const chooser = page.waitForEvent("filechooser", { timeout: 7000 });
      await button.click({ timeout: 7000 }).catch(() => undefined);
      const fileChooser = await chooser.catch(() => null);
      if (!fileChooser) continue;
      await fileChooser.setFiles(imageFile);
      console.log(`[naver-agent] thumbnail selected via ${selector}.`);
      selected = true;
      break;
    }
    if (!selected) throw new Error("NAVER_IMAGE_INPUT_NOT_FOUND");
  }

  await page.waitForTimeout(8000);
  const after = await countNaverImages(page);
  if (after <= before) throw new Error(`NAVER_IMAGE_ATTACH_NOT_CONFIRMED_${before}_${after}`);
  console.log(`[naver-agent] thumbnail attachment confirmed: images=${before}->${after}`);
}

async function pasteTextWithClipboard(page: import("playwright").Page, value: string) {
  const text = normalizeEditorText(value);
  const copied = await page.evaluate(async (clipboardText) => {
    await navigator.clipboard.writeText(clipboardText);
    return true;
  }, text).then(
    () => true,
    () => false,
  );
  if (!copied) return false;
  await page.keyboard.press(process.platform === "darwin" ? "Meta+V" : "Control+V");
  return true;
}


async function fillFirstEditorTarget(
  page: import("playwright").Page,
  selectors: string[],
  value: string,
  label: string,
) {
  const scopes = [page, ...page.frames()];

  for (const scope of scopes) {
    for (const selector of selectors) {
      const target = scope.locator(selector).first();
      if (!(await target.count().catch(() => 0))) continue;

      await target.click({ timeout: 10000 }).catch(() => undefined);

      const normalizedValue = normalizeEditorText(value);
      const pasted = await pasteTextWithClipboard(page, normalizedValue).then(
        () => true,
        () => false,
      );
      const filled = pasted || await target.fill(normalizedValue, { timeout: 10000 }).then(
        () => true,
        () => false,
      );

      if (!filled) {
        await page.keyboard.insertText(normalizedValue).catch(() => undefined);
      }

      console.log(`[naver-agent] filled ${label} via ${selector}${pasted ? " (clipboard paste)" : ""}`);
      return true;
    }
  }

  console.warn(`[naver-agent] could not find ${label} input target.`);
  return false;
}

async function clickNaverEditorSave(page: import("playwright").Page) {
  await dismissNaverDraftModal(page).catch(() => undefined);

  const selectors = [
    'button:has-text("저장")',
    'a:has-text("저장")',
    '[role="button"]:has-text("저장")',
    '.se-save-button',
    'button[class*="save"]',
    'a[class*="save"]',
  ];

  for (const selector of selectors) {
    const target = page.locator(selector).first();
    if (!(await target.count().catch(() => 0))) continue;

    page.once("dialog", async (dialog) => {
      console.log(`[naver-agent] accepting save dialog: ${dialog.message()}`);
      await dialog.accept().catch(() => undefined);
    });

    await target.click({ timeout: 10000 });
    console.log(`[naver-agent] clicked Naver editor save via ${selector}`);
    await page.waitForTimeout(5000);
    await dismissNaverDraftModal(page).catch(() => undefined);
    return true;
  }

  console.warn("[naver-agent] could not find Naver editor save button.");
  return false;
}

async function dismissNaverDraftModal(page: import("playwright").Page) {
  const modal = page.locator('text="임시저장 글"').first();
  if (!(await modal.count().catch(() => 0))) return false;

  const closeSelectors = [
    'button[aria-label="닫기"]',
    'button:has-text("닫기")',
    '.se-popup .se-popup-close',
    '.se-popup-close',
    'button.close',
  ];

  for (const selector of closeSelectors) {
    const closeButton = page.locator(selector).first();
    if (!(await closeButton.count().catch(() => 0))) continue;
    await closeButton.click({ timeout: 5000 }).catch(() => undefined);
    console.log(`[naver-agent] dismissed draft modal via ${selector}`);
    return true;
  }

  await page.keyboard.press("Escape").catch(() => undefined);
  console.log("[naver-agent] dismissed draft modal via Escape");
  return true;
}

async function waitForNaverAutosave(page: import("playwright").Page) {
  await dismissNaverDraftModal(page).catch(() => undefined);
  console.log("[naver-agent] waiting for Naver editor autosave...");
  await page.waitForTimeout(15000);
  await dismissNaverDraftModal(page).catch(() => undefined);
  console.log("[naver-agent] autosave wait completed.");
}

export async function testNaverBrowser() {
  const testUrl = process.env.NAVER_BROWSER_TEST_URL?.trim() || "https://naver.com";
  const profileDir = process.env.NAVER_BROWSER_PROFILE_DIR?.trim() || "./.naver-profile";
  const browserChannel = process.env.NAVER_BROWSER_CHANNEL?.trim();
  const browserExecutablePath = process.env.NAVER_BROWSER_EXECUTABLE_PATH?.trim();
  const cdpEndpoint = process.env.NAVER_CDP_ENDPOINT?.trim();

  console.log(`[naver-agent] browser test start: ${testUrl}`);
  console.log(`[naver-agent] browser config: ${describeBrowserConfig(profileDir, browserChannel, browserExecutablePath, cdpEndpoint)}`);

  const { chromium } = await import("playwright");
  let contextBrowser;
  let page;

  if (cdpEndpoint) {
    const browser = await chromium.connectOverCDP(cdpEndpoint);
    contextBrowser = browser.contexts()[0] ?? await browser.newContext({ viewport: null });
    page = contextBrowser.pages()[0] ?? await contextBrowser.newPage();
    openBrowserContexts.add(browser);
  } else {
    contextBrowser = await launchPersistentBrowserContext(chromium, profileDir, browserChannel, browserExecutablePath);
    page = contextBrowser.pages()[0] ?? await contextBrowser.newPage();
    openBrowserContexts.add(contextBrowser);
  }

  await page.bringToFront().catch(() => undefined);
  await page.goto(testUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
  console.log(`[naver-agent] browser test opened: ${page.url()}`);

  if (stdin.isTTY) {
    const rl = createInterface({ input: stdin, output: stdout });
    try {
      await rl.question("[naver-agent] Browser visible? Press Enter to close test> ");
    } finally {
      rl.close();
    }
  }

  await contextBrowser.close().catch(() => undefined);
}

export async function runNaverWriter(job: NaverDraftJob, context: { draftFile: string; assetBaseUrl: string }): Promise<WriterResult> {
  const dryRun = !isExplicitLiveMode();
  const allowDraftSave = process.env.NAVER_ALLOW_DRAFT_SAVE === "true";
  if (dryRun) {
    return {
      status: "draft_saved",
      externalUrl: `dry-run://${context.draftFile}`,
    };
  }

  const writeUrl = process.env.NAVER_BLOG_WRITE_URL?.trim() || "https://blog.naver.com/PostWriteForm.naver";
  const profileDir = process.env.NAVER_BROWSER_PROFILE_DIR?.trim() || "./.naver-profile";
  const browserChannel = process.env.NAVER_BROWSER_CHANNEL?.trim();
  const browserExecutablePath = process.env.NAVER_BROWSER_EXECUTABLE_PATH?.trim();
  const cdpEndpoint = process.env.NAVER_CDP_ENDPOINT?.trim();

  console.log(`[naver-agent] opening browser (${describeBrowserConfig(profileDir, browserChannel, browserExecutablePath, cdpEndpoint)})`);

  const { chromium } = await import("playwright");
  let contextBrowser;
  let page;

  if (cdpEndpoint) {
    console.log(`[naver-agent] connecting to existing browser via CDP: ${cdpEndpoint}`);
    const browser = await chromium.connectOverCDP(cdpEndpoint);
    contextBrowser = browser.contexts()[0] ?? await browser.newContext({ viewport: null });
    page = contextBrowser.pages()[0] ?? await contextBrowser.newPage();
    openBrowserContexts.add(browser);
  } else {
    contextBrowser = await launchPersistentBrowserContext(chromium, profileDir, browserChannel, browserExecutablePath);
    openBrowserContexts.add(contextBrowser);
    page = contextBrowser.pages()[0] ?? await contextBrowser.newPage();
  }

  await page.bringToFront().catch(() => undefined);

  try {
    await page.goto(writeUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
    let blockedStatus = await detectBlockedStatus(page);
    if (blockedStatus) {
      const shouldRetry = await waitForManualNaverVerification(blockedStatus, page.url());
      if (shouldRetry) {
        await page.goto(writeUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
        blockedStatus = await detectBlockedStatus(page);
      }
      if (blockedStatus) {
        return { status: blockedStatus, externalUrl: page.url(), errorCode: "NAVER_LOGIN_OR_SECURITY_REQUIRED", errorMessage: "Naver login/security verification is required in the local browser." };
      }
    }

    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => undefined);
    await dismissNaverDraftModal(page).catch(() => undefined);

    const titleSelectors = [
      'textarea[placeholder*="제목"]',
      'input[placeholder*="제목"]',
      "input.se-title-input",
      "textarea.se-title-input",
      ".se-title-text p",
      '.se-title-text [contenteditable="true"]',
      '[contenteditable="true"][aria-label*="제목"]',
      '[contenteditable="true"][data-placeholder*="제목"]',
    ];
    const bodySelectors = [
      ".se-section-text p",
      '.se-component-content [contenteditable="true"]',
      '.se-main-container [contenteditable="true"]',
      '[contenteditable="true"][data-placeholder*="내용"]',
      '[contenteditable="true"][aria-label*="본문"]',
      'div[contenteditable="true"]',
      "textarea",
    ];

    const titleFilled = await fillFirstEditorTarget(page, titleSelectors, job.title, "title");
    const bodyFilled = await fillFirstEditorTarget(page, bodySelectors, job.body, "body");

    if (!titleFilled || !bodyFilled) {
      return {
        status: "user_publish_required",
        externalUrl: page.url(),
        errorCode: "NAVER_EDITOR_INPUT_NOT_FOUND",
        errorMessage: `Naver editor input target was not found. titleFilled=${titleFilled}, bodyFilled=${bodyFilled}. Please paste manually in the opened browser.`,
      };
    }

    const readability = await verifyNaverEditorReadability(page, job.body);
    if (!readability.ok) {
      return {
        status: "readability_failed",
        externalUrl: page.url(),
        errorCode: "NAVER_EDITOR_READABILITY_FAILED",
        errorMessage: `Naver editor body verification failed. characters=${readability.actual.characterCount}/${readability.expected.characterCount}, lines=${readability.actual.lineCount}/${readability.expected.lineCount}. Draft save was stopped.`,
      };
    }

    if (job.allowImageUpload && job.thumbnailImageUrl) {
      try {
        const thumbnailFile = await downloadTrustedThumbnail({
          page,
          jobId: job.id,
          imageUrl: job.thumbnailImageUrl,
          assetBaseUrl: context.assetBaseUrl,
        });
        await uploadNaverThumbnail(page, bodySelectors, thumbnailFile);
      } catch (error) {
        return {
          status: "failed",
          externalUrl: page.url(),
          errorCode: "NAVER_THUMBNAIL_UPLOAD_FAILED",
          errorMessage: error instanceof Error ? error.message : String(error),
        };
      }
    }

    if (allowDraftSave) {
      if (await clickNaverEditorSave(page)) {
        return { status: "draft_saved", externalUrl: page.url() };
      }

      await waitForNaverAutosave(page);
      return {
        status: "user_publish_required",
        externalUrl: page.url(),
        errorCode: "NAVER_SAVE_BUTTON_NOT_FOUND",
        errorMessage: "Draft content was entered, but the Naver editor save button was not found. Please click 저장 manually.",
      };
    }
    return { status: "user_publish_required", externalUrl: page.url() };
  } catch (error) {
    return { status: "failed", errorCode: "NAVER_WRITER_FAILED", errorMessage: error instanceof Error ? error.message : String(error) };
  }
}
