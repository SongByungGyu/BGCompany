import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export type NaverDraftJob = {
  id: string;
  status?: string;
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
  contentImages?: Array<{
    id: string;
    role: "thumbnail" | "body";
    type: "thumbnail" | "chart" | "related-image";
    title: string;
    placementAfterHeading: string;
    imageUrl: string;
    caption: string;
    sourceLabel: string;
    licenseType: string;
    usageAllowed: boolean;
    dataKeys: string[];
    width: number;
    height: number;
    fileFormat: string;
    uploadFormat: string;
    fileVerified: boolean;
  }>;
  imageQuality?: { status: "passed" | "blocked"; issues?: Array<{ code: string; message: string }> } | null;
  references?: Array<{ title?: string; sourceName?: string; originalUrl?: string; url?: string }>;
  competitorBlogReferences?: Array<{ title?: string; blogName?: string; url?: string }>;
  allowImageUpload?: boolean;
  allowPublish?: boolean;
  publishKey?: string | null;
  marketDate?: string | null;
  scheduleSlot?: string | null;
  errorCode?: string | null;
  disclaimer: string | null;
};

export type WriterResult = {
  status: "draft_saved" | "publish_ready" | "published" | "user_publish_required" | "failed" | "login_required" | "captcha_required" | "security_check_required" | "readability_failed" | "image_upload_failed" | "image_quality_failed" | "draft_save_failed" | "publish_blocked" | "publish_failed" | "duplicate_blocked";
  externalUrl?: string;
  publishedUrl?: string;
  naverPostId?: string;
  errorCode?: string;
  errorMessage?: string;
};

type WriterContext = {
  draftFile: string;
  assetBaseUrl: string;
  reportProgress?: (body: Record<string, unknown>) => Promise<void>;
  beginPublish?: () => Promise<{ allowed: boolean; status: string; errorCode?: string | null }>;
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

export type EditorInputStep =
  | { type: "text"; value: string }
  | { type: "enter" };

export function buildMultilineEditorInputSteps(value: string): EditorInputStep[] {
  const normalized = normalizeEditorText(value);
  if (!normalized) return [];
  const steps: EditorInputStep[] = [];
  normalized.split("\n").forEach((line, index) => {
    if (index > 0) steps.push({ type: "enter" });
    if (line) steps.push({ type: "text", value: line });
  });
  return steps;
}

export function selectNaverArticleUrls(value: string) {
  return normalizeEditorText(value)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^https?:\/\/\S+$/.test(line));
}

export function normalizeNaverCategoryLabel(value: string) {
  return value.replace(/\s+/g, "").replace(/^하위카테고리/, "");
}

export function prepareNaverPublicationBody(value: string) {
  return normalizeEditorText(value)
    .replace(
      "확인되지 않은 국내 일정은 별도로 넣지 않았습니다. 새 일정은 날짜와 공식 내용을 확인한 뒤 시장 반응을 판단할 필요가 있습니다.",
      "추가 일정은 공식 발표 여부를 확인한 뒤 시장 반응과 함께 살펴볼 필요가 있습니다.",
    )
    .replace("5. 이번 주에 눈여겨볼 기회와 위험", "5.\u00a0이번 주 기회와 위험")
    .split("\n")
    .map((line) => {
      if (/^https?:\/\/\S+$/.test(line.trim())) return "원문 보기";
      if (/^[1-6]\.\s+/.test(line)) return line.replace(/^([1-6]\.)\s+/, "$1\u00a0");
      return line;
    })
    .join("\n");
}

export function selectNaverEmphasisParagraphs(value: string) {
  const candidates = new Set(["기회 요인", "위험 요인"]);
  return normalizeEditorText(value)
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => candidates.has(line));
}

export function selectNaverSectionHeadings(value: string) {
  const headings: string[] = [];
  let reachedArticleSection = false;
  for (const rawLine of normalizeEditorText(value).split("\n")) {
    const line = rawLine.replace(/\s+/g, " ").trim();
    if (!line) continue;
    if (line === "함께 확인한 기사") {
      reachedArticleSection = true;
      headings.push(line);
      continue;
    }
    if (line === "마무리") {
      headings.push(line);
      continue;
    }
    if (!reachedArticleSection && /^\d+\.\s+/.test(line)) headings.push(line);
  }
  return headings;
}

function readabilityMetrics(value: string) {
  const normalized = value.replace(/\r\n/g, "\n").trim();
  return {
    characterCount: normalized.replace(/\s/g, "").length,
    lineCount: normalized.split("\n").map((line) => line.trim()).filter(Boolean).length,
    paragraphCount: normalized.split(/\n{2,}/).map((item) => item.trim()).filter(Boolean).length,
  };
}

export function pickMostReadableEditorText(candidates: string[]) {
  let selected = "";
  let selectedMetrics = readabilityMetrics(selected);
  for (const candidate of candidates) {
    const metrics = readabilityMetrics(candidate);
    if (
      metrics.characterCount > selectedMetrics.characterCount ||
      (metrics.characterCount === selectedMetrics.characterCount && metrics.lineCount > selectedMetrics.lineCount) ||
      (metrics.characterCount === selectedMetrics.characterCount && metrics.lineCount === selectedMetrics.lineCount && metrics.paragraphCount > selectedMetrics.paragraphCount)
    ) {
      selected = candidate;
      selectedMetrics = metrics;
    }
  }
  return selected;
}

async function readNaverEditorText(page: import("playwright").Page) {
  const selectors = [
    ".se-main-container",
    ".se-section-text",
    ".se-section-text p",
    ".se-text-paragraph",
    ".se-component-content",
    '[contenteditable="true"][aria-label*="본문"]',
    '[contenteditable="true"][data-placeholder*="내용"]',
  ];
  const candidates: string[] = [];
  for (const scope of [page, ...page.frames()]) {
    for (const selector of selectors) {
      const targets = scope.locator(selector);
      if (!(await targets.count().catch(() => 0))) continue;
      const texts = await targets.allInnerTexts().catch(() => [] as string[]);
      const nonEmpty = texts.filter((text) => text.trim());
      candidates.push(...nonEmpty);
      if (nonEmpty.length > 1) candidates.push(nonEmpty.join("\n"));
    }
  }
  const selected = pickMostReadableEditorText(candidates);
  const metrics = readabilityMetrics(selected);
  console.log(`[naver-agent] editor text candidates: count=${candidates.length}, selected_chars=${metrics.characterCount}, selected_lines=${metrics.lineCount}`);
  return selected;
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

export function validateJobImageManifest(job: NaverDraftJob) {
  const images = job.contentImages ?? [];
  const thumbnail = images.filter((image) => image.role === "thumbnail");
  const bodyImages = images.filter((image) => image.role === "body");
  const issues: string[] = [];
  if (job.imageQuality?.status !== "passed") issues.push("IMAGE_QUALITY_NOT_PASSED");
  if (thumbnail.length !== 1 || thumbnail[0]?.imageUrl !== job.thumbnailImageUrl) issues.push("IMAGE_THUMBNAIL_MANIFEST_INVALID");
  if (bodyImages.length < 2 || bodyImages.length > 4) issues.push("IMAGE_BODY_COUNT_INVALID");
  if (new Set(images.map((image) => image.imageUrl)).size !== images.length) issues.push("IMAGE_DUPLICATE_URL");
  if (bodyImages.map((image) => image.imageUrl).join("\n") !== (job.inlineImageUrls ?? []).join("\n")) issues.push("IMAGE_INLINE_ORDER_MISMATCH");
  if (bodyImages.some((image) => !image.placementAfterHeading || !job.body.includes(image.placementAfterHeading))) issues.push("IMAGE_PLACEMENT_HEADING_MISSING");
  if (images.some((image) => !image.usageAllowed || !image.fileVerified || !image.caption || !image.sourceLabel)) issues.push("IMAGE_METADATA_INCOMPLETE");
  if (images.some((image) => image.fileFormat === "image/svg+xml" && image.uploadFormat !== "image/png")) issues.push("IMAGE_UPLOAD_FORMAT_INVALID");
  if (bodyImages.every((image) => image.type !== "chart" || image.dataKeys.length === 0)) issues.push("IMAGE_VERIFIED_CHART_REQUIRED");
  return { ok: issues.length === 0, issues, thumbnail: thumbnail[0], bodyImages };
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
  fileStem?: string;
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
  const fileStem = safeFileSegment(input.fileStem ?? "thumbnail");
  if (contentType !== "image/svg+xml") {
    const extension = contentType === "image/jpeg" ? "jpg" : contentType === "image/webp" ? "webp" : "png";
    const outputFile = path.join(outputDir, `${fileStem}.${extension}`);
    await writeFile(outputFile, buffer);
    console.log(`[naver-agent] trusted image downloaded: ${url.pathname}`);
    return outputFile;
  }

  const svg = buffer.toString("utf8");
  if (!svg.includes("<svg")) throw new Error("NAVER_SVG_INVALID");
  const renderPage = await input.page.context().newPage();
  const outputFile = path.join(outputDir, `${fileStem}.png`);
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
  console.log(`[naver-agent] trusted SVG converted to PNG: ${url.pathname}`);
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

async function selectBodyForThumbnailReplacement(page: import("playwright").Page, selectors: string[]) {
  for (const scope of [page, ...page.frames()]) {
    for (const selector of selectors) {
      const target = scope.locator(selector).first();
      if (!(await target.count().catch(() => 0))) continue;
      if (!(await target.isVisible().catch(() => false))) continue;
      await target.click({ timeout: 5000 });
      await target.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
      console.log(`[naver-agent] selected initial body block for thumbnail via ${selector}`);
      return true;
    }
  }
  return false;
}

async function attachNaverImage(page: import("playwright").Page, imageFile: string, label: string) {
  const before = await countNaverImages(page);
  const fileInputs = page.locator('input[type="file"][accept*="image"], input[type="file"][multiple]');
  if (await fileInputs.count().catch(() => 0)) {
    await fileInputs.first().setInputFiles(imageFile, { timeout: 10000 });
    console.log(`[naver-agent] ${label} selected through Naver image input.`);
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
      console.log(`[naver-agent] ${label} selected via ${selector}.`);
      selected = true;
      break;
    }
    if (!selected) throw new Error("NAVER_IMAGE_INPUT_NOT_FOUND");
  }

  await page.waitForTimeout(8000);
  const after = await countNaverImages(page);
  if (after <= before) throw new Error(`NAVER_IMAGE_ATTACH_NOT_CONFIRMED_${before}_${after}`);
  if (after !== before + 1) throw new Error(`NAVER_IMAGE_ATTACH_COUNT_UNEXPECTED_${before}_${after}`);
  console.log(`[naver-agent] ${label} attachment confirmed: images=${before}->${after}`);
}

async function uploadNaverThumbnail(page: import("playwright").Page, bodySelectors: string[], imageFile: string) {
  await dismissNaverDraftModal(page).catch(() => undefined);
  if (!(await selectBodyForThumbnailReplacement(page, bodySelectors))) {
    throw new Error("NAVER_THUMBNAIL_BODY_TARGET_NOT_FOUND");
  }
  await attachNaverImage(page, imageFile, "thumbnail");
}

async function focusAfterNaverHeading(page: import("playwright").Page, heading: string) {
  const selectors = [".se-text-paragraph", ".se-component-content p", '[contenteditable="true"] p'];
  const expected = heading.replace(/\s+/g, " ").trim();
  for (const scope of [page, ...page.frames()]) {
    for (const selector of selectors) {
      const targets = scope.locator(selector);
      const count = await targets.count().catch(() => 0);
      for (let index = 0; index < count; index += 1) {
        const target = targets.nth(index);
        const text = (await target.innerText({ timeout: 3000 }).catch(() => "")).replace(/\s+/g, " ").trim();
        if (text !== expected) continue;
        const box = await target.boundingBox().catch(() => null);
        await target.click({
          timeout: 5000,
          ...(box ? { position: { x: Math.max(2, box.width - 4), y: Math.max(2, box.height / 2) } } : {}),
        });
        const caretReady = await target.evaluate((element) => {
          const paragraph = element as HTMLElement;
          const editor = paragraph.matches('[contenteditable="true"]')
            ? paragraph
            : paragraph.querySelector<HTMLElement>('[contenteditable="true"]')
              ?? paragraph.closest<HTMLElement>('[contenteditable="true"]');
          editor?.focus();
          const range = document.createRange();
          range.selectNodeContents(paragraph);
          range.collapse(false);
          const selection = window.getSelection();
          if (!selection) return false;
          selection.removeAllRanges();
          selection.addRange(range);
          return Boolean(selection.anchorNode && paragraph.contains(selection.anchorNode));
        }).catch(() => false);
        if (!caretReady) {
          console.warn(`[naver-agent] DOM caret selection fallback used: ${heading}`);
          await page.keyboard.press("End");
        }
        await page.keyboard.press("Enter");
        await page.waitForTimeout(100);
        console.log(`[naver-agent] image placement heading focused: ${heading}`);
        return true;
      }
    }
  }
  return false;
}

async function findNaverExactParagraph(page: import("playwright").Page, expected: string) {
  const normalizedExpected = expected.replace(/\s+/g, " ").trim();
  for (const scope of [page, ...page.frames()]) {
    const paragraphs = scope.locator(".se-section-text p, .se-text-paragraph");
    const count = await paragraphs.count().catch(() => 0);
    for (let index = 0; index < count; index += 1) {
      const paragraph = paragraphs.nth(index);
      const text = (await paragraph.innerText().catch(() => "")).replace(/\s+/g, " ").trim();
      if (text === normalizedExpected) return { scope, paragraph };
    }
  }
  return null;
}

async function insertImageCaption(
  page: import("playwright").Page,
  caption: string,
  sourceLabel: string,
  includeSource = true,
) {
  const value = includeSource ? `${caption} · ${sourceLabel}` : caption;
  for (const scope of [page, ...page.frames()]) {
    const images = scope.locator(".se-component.se-image");
    if (!(await images.count().catch(() => 0))) continue;
    const image = images.last();
    const resource = image.locator("img.se-image-resource, img").first();
    if (!(await resource.count().catch(() => 0))) continue;
    await resource.click({ timeout: 5000 });
    const nativeCaption = image.locator(".se-caption p").first();
    if (!(await nativeCaption.count().catch(() => 0))) continue;
    await nativeCaption.waitFor({ state: "visible", timeout: 5000 });
    await nativeCaption.click({ timeout: 5000 });
    if (!(await page.keyboard.insertText(value).then(() => true, () => false))) return false;
    await page.waitForTimeout(200);
    const actual = (await nativeCaption.innerText().catch(() => "")).replace(/\s+/g, " ").trim();
    return actual === value.replace(/\s+/g, " ").trim();
  }
  return false;
}

async function formatNaverSourceParagraph(page: import("playwright").Page, sourceLabel: string) {
  const target = await findNaverExactParagraph(page, sourceLabel);
  if (!target) return false;
  const { scope, paragraph } = target;
  await paragraph.click({ clickCount: 3, delay: 80, timeout: 5000, force: true });
  const centerButton = scope.locator(".se-contents-toolbar-cycle-toggle-button.se-align-center-toolbar-button:visible").first();
  if (!(await centerButton.count().catch(() => 0))) return false;
  await centerButton.click({ timeout: 5000 });
  await scope.locator(".se-font-size-code-toolbar-button:visible").first().click({ timeout: 5000 });
  await scope.locator(".se-toolbar-option-font-size-code-fs13-button:visible").click({ timeout: 5000 });
  await page.waitForTimeout(200);
  const formatted = await paragraph.evaluate((element) => ({
    centered: element.classList.contains("se-text-paragraph-align-center"),
    size13: Boolean(element.querySelector(".se-fs13")),
  })).catch(() => ({ centered: false, size13: false }));
  if (!formatted.centered || !formatted.size13) return false;
  await paragraph.click({ timeout: 5000 });
  await page.keyboard.press("Home");
  await page.waitForTimeout(100);
  return true;
}

async function prepareNaverInlineImagePlacement(
  page: import("playwright").Page,
  heading: string,
  sourceLabel: string,
) {
  if (!(await focusAfterNaverHeading(page, heading))) return false;
  if (!(await page.keyboard.insertText(sourceLabel).then(() => true, () => false))) return false;
  await page.waitForTimeout(150);
  return formatNaverSourceParagraph(page, sourceLabel);
}

async function applyNaverSectionTitles(page: import("playwright").Page, body: string) {
  const headings = selectNaverSectionHeadings(body);
  for (const heading of headings) {
    let target = await findNaverExactParagraph(page, heading);
    if (!target) throw new Error(`NAVER_SECTION_TITLE_NOT_FOUND_${heading}`);
    await page.keyboard.press("Escape").catch(() => undefined);
    await target.paragraph.click({ timeout: 5000 });
    const formatButton = target.scope.locator(".se-text-format-toolbar-button").first();
    const sectionTitleButton = target.scope.locator(".se-toolbar-option-text-format-sectionTitle-button").first();
    if (!(await formatButton.count().catch(() => 0))) throw new Error(`NAVER_SECTION_TITLE_TOOLBAR_MISSING_${heading}`);
    await formatButton.click({ timeout: 5000 });
    await sectionTitleButton.click({ timeout: 5000 });
    await page.waitForTimeout(350);
    target = await findNaverExactParagraph(page, heading);
    const isSectionTitle = target
      ? await target.paragraph.evaluate((element) => element.closest(".se-component")?.classList.contains("se-sectionTitle") ?? false)
      : false;
    if (!target || !isSectionTitle) throw new Error(`NAVER_SECTION_TITLE_NOT_APPLIED_${heading}`);
    await target.paragraph.click({ clickCount: 3, delay: 80, timeout: 5000 });
    await page.keyboard.press("Control+B");
    await page.waitForTimeout(150);
    if (!(await target.paragraph.locator("b").count().catch(() => 0))) throw new Error(`NAVER_SECTION_TITLE_BOLD_FAILED_${heading}`);
  }
  console.log(`[naver-agent] section title formatting applied: ${headings.length}`);
}

async function applyNaverEmphasisParagraphs(page: import("playwright").Page, body: string) {
  const labels = selectNaverEmphasisParagraphs(body);
  for (const label of labels) {
    const target = await findNaverExactParagraph(page, label);
    if (!target) throw new Error(`NAVER_EMPHASIS_PARAGRAPH_NOT_FOUND_${label}`);
    await target.paragraph.click({ clickCount: 3, delay: 80, timeout: 5000 });
    await page.keyboard.press("Control+B");
    await page.waitForTimeout(150);
    if (!(await target.paragraph.locator("b").count().catch(() => 0))) throw new Error(`NAVER_EMPHASIS_PARAGRAPH_BOLD_FAILED_${label}`);
  }
}

async function applyNaverArticleLinks(page: import("playwright").Page, urls: string[]) {
  if (urls.length === 0) return;
  const targets = [];
  const scopes = [page, ...page.frames().filter((frame) => frame !== page.mainFrame())];
  for (const scope of scopes) {
    const paragraphs = scope.locator(".se-section-text p, .se-text-paragraph");
    for (let index = 0; index < await paragraphs.count().catch(() => 0); index += 1) {
      const paragraph = paragraphs.nth(index);
      const text = (await paragraph.innerText().catch(() => "")).replace(/\s+/g, " ").trim();
      if (text === "원문 보기") targets.push({ scope, paragraph });
    }
  }
  if (targets.length !== urls.length) throw new Error(`NAVER_ARTICLE_LINK_TARGET_COUNT_${targets.length}_${urls.length}`);
  for (let index = 0; index < urls.length; index += 1) {
    const { scope, paragraph } = targets[index];
    await paragraph.click({ clickCount: 3, delay: 80, timeout: 5000 });
    await scope.locator(".se-link-toolbar-button:visible").first().click({ timeout: 5000 });
    await scope.locator("input.se-custom-layer-link-input:visible").fill(urls[index], { timeout: 5000 });
    await scope.locator("button.se-custom-layer-link-apply-button:visible").click({ timeout: 5000 });
    await page.waitForTimeout(200);
  }
  const linkedUrls: string[] = [];
  for (const scope of scopes) {
    linkedUrls.push(...await scope.locator(".se-link[data-href]").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-href") ?? "")).catch(() => []));
  }
  const missing = urls.filter((url) => !linkedUrls.includes(url));
  if (missing.length) throw new Error(`NAVER_ARTICLE_LINK_VERIFY_FAILED_${missing.length}`);
}

async function removeNaverOglinkPreviews(page: import("playwright").Page) {
  await page.waitForTimeout(1000);
  for (const scope of [page, ...page.frames()]) {
    let count = await scope.locator(".se-component.se-oglink").count().catch(() => 0);
    while (count > 0) {
      const card = scope.locator(".se-component.se-oglink").first();
      await card.click({ timeout: 5000 });
      const deleteButton = card.locator(".se-delete-toolbar-button").last();
      if (await deleteButton.count().catch(() => 0) && await deleteButton.isVisible().catch(() => false)) {
        await deleteButton.click({ timeout: 5000 });
      } else {
        await page.keyboard.press("Delete");
      }
      await page.waitForTimeout(300);
      const after = await scope.locator(".se-component.se-oglink").count().catch(() => 0);
      if (after >= count) throw new Error(`NAVER_OGLINK_DELETE_FAILED_${count}_${after}`);
      count = after;
    }
  }
}

async function verifyNaverImagePlacements(page: import("playwright").Page, bodyImages: NonNullable<NaverDraftJob["contentImages"]>) {
  for (const image of bodyImages) {
    let matched = false;
    let diagnostic = "heading_not_found";
    let bestScore = -1;
    const scopes = [page, ...page.frames().filter((frame) => frame !== page.mainFrame())];
    for (const scope of scopes) {
      const result = await scope.evaluate(({ heading, caption, sourceLabel }) => {
        const root = document.querySelector(".se-main-container") ?? document.body;
        const paragraphs = Array.from(new Set(Array.from(root.querySelectorAll<HTMLElement>(
          ".se-text-paragraph, .se-component-content p, [contenteditable='true'] p",
        ))));
        const editorImages = Array.from(root.querySelectorAll<HTMLImageElement>("img"));
        const normalizedHeading = (heading ?? "").replace(/\s+/g, " ").trim();
        const headingNode = paragraphs.find((node) => (node.innerText ?? "").replace(/\s+/g, " ").trim() === normalizedHeading);
        if (!headingNode) return { matched: false, diagnostic: "heading_not_found", imageCount: editorImages.length };
        const nextHeading = paragraphs.find((node) => (
          Boolean(headingNode.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING)
          && /^\d+\.\s+/.test((node.innerText ?? "").replace(/\s+/g, " ").trim())
        ));
        const imageBetween = editorImages.some((node) => (
          Boolean(headingNode.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING)
          && (!nextHeading || Boolean(node.compareDocumentPosition(nextHeading) & Node.DOCUMENT_POSITION_FOLLOWING))
        ));
        const editorText = ((root as HTMLElement).innerText ?? "").replace(/\s+/g, " ").trim();
        const captionFound = editorText.includes((caption ?? "").replace(/\s+/g, " ").trim());
        const sourceFound = editorText.includes((sourceLabel ?? "").replace(/\s+/g, " ").trim());
        const failures = [
          !imageBetween && "image_not_between_headings",
          !captionFound && "caption_not_found",
          !sourceFound && "source_not_found",
        ].filter(Boolean);
        return {
          matched: imageBetween && captionFound && sourceFound,
          diagnostic: failures.join("+") || "ok",
          imageCount: editorImages.length,
        };
      }, {
        heading: image.placementAfterHeading,
        caption: image.caption,
        sourceLabel: image.sourceLabel,
      }).catch((error) => ({
        matched: false,
        diagnostic: `placement_evaluation_failed_${error instanceof Error ? error.message.split("\n")[0] : String(error)}`,
        imageCount: 0,
      }));
      matched = result.matched;
      const score = (result.imageCount * 100) + (result.diagnostic === "heading_not_found" ? 0 : 10) + (result.diagnostic.startsWith("placement_evaluation_failed") ? -1 : 0);
      if (score > bestScore) {
        bestScore = score;
        diagnostic = `${result.diagnostic}_images_${result.imageCount}`;
      }
      if (matched) break;
    }
    if (!matched) return { ok: false, imageId: image.id, diagnostic };
  }
  return { ok: true };
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

async function insertMultilineEditorSteps(page: import("playwright").Page, steps: EditorInputStep[]) {
  if (steps.length === 0) return false;
  for (const [index, step] of steps.entries()) {
    const inserted = step.type === "enter"
      ? await page.keyboard.press("Enter").then(() => true, () => false)
      : await page.keyboard.insertText(step.value).then(() => true, () => false);
    if (!inserted) return false;
    await page.waitForTimeout(step.type === "enter" ? 35 : 25);
    if (index > 0 && index % 8 === 0) await page.waitForTimeout(120);
  }
  return true;
}

async function fillMultilineEditorTarget(
  page: import("playwright").Page,
  selectors: string[],
  value: string,
  label: string,
) {
  const steps = buildMultilineEditorInputSteps(value);
  if (steps.length === 0) return false;
  const deadline = Date.now() + 20_000;
  do {
    const scopes = [page, ...page.frames().filter((frame) => frame !== page.mainFrame())];
    for (const scope of scopes) {
      for (const selector of selectors) {
        const target = scope.locator(selector).first();
        if (!(await target.count().catch(() => 0))) continue;
        const visible = await target.isVisible().catch(() => false);
        const box = await target.boundingBox().catch(() => null);
        if (!visible || !box || box.width <= 0 || box.height <= 0 || box.x < -1000) continue;
        const clickAttempt = await target.click({ timeout: 1500 }).then(
          () => ({ ok: true, reason: "normal" }),
          (error) => ({ ok: false, reason: error instanceof Error ? error.message.split("\n")[0] : String(error) }),
        );
        if (!clickAttempt.ok) {
          console.warn(`[naver-agent] ${label} click blocked via ${selector}: visible=${visible}, box=${box ? `${Math.round(box.x)},${Math.round(box.y)},${Math.round(box.width)},${Math.round(box.height)}` : "none"}, reason=${clickAttempt.reason}`);
          continue;
        }
        const editorFocused = await target.evaluate((element) => {
          const section = element.closest(".se-section-text");
          const anchor = window.getSelection()?.anchorNode ?? null;
          return Boolean(section?.classList.contains("se-is-focused") && anchor && section.contains(anchor));
        }).catch(() => selector !== ".se-section-text p" && selector !== ".se-section-text");
        if (!editorFocused) {
          console.warn(`[naver-agent] ${label} click did not establish editor selection via ${selector}; waiting for editor readiness.`);
          continue;
        }
        if (!(await insertMultilineEditorSteps(page, steps))) {
          console.warn(`[naver-agent] failed while inserting ${label} via ${selector}; refusing a second target to avoid duplicate text.`);
          return false;
        }
        console.log(`[naver-agent] filled ${label} via ${selector} (${steps.length} line-aware steps)`);
        return true;
      }
    }
    if (Date.now() < deadline) await page.waitForTimeout(300);
  } while (Date.now() < deadline);

  console.warn(`[naver-agent] could not find or fill ${label} input target after 20 seconds.`);
  return false;
}


async function fillFirstEditorTarget(
  page: import("playwright").Page,
  selectors: string[],
  value: string,
  label: string,
) {
  const normalizedValue = normalizeEditorText(value);
  if (!normalizedValue) return false;

  const deadline = Date.now() + 30_000;
  let attempts = 0;
  let observedTargets = 0;

  do {
    attempts += 1;
    await dismissNaverDraftModal(page).catch(() => undefined);
    const scopes = [page, ...page.frames().filter((frame) => frame !== page.mainFrame())];

    for (const scope of scopes) {
      for (const selector of selectors) {
        const targets = scope.locator(selector);
        const count = await targets.count().catch(() => 0);
        observedTargets = Math.max(observedTargets, count);
        for (let index = 0; index < count; index += 1) {
          const target = targets.nth(index);
          const visible = await target.isVisible().catch(() => false);
          const box = await target.boundingBox().catch(() => null);
          if (!visible || !box || box.width <= 0 || box.height <= 0 || box.x < -1000) continue;

          const clicked = await target.click({ timeout: 2000 }).then(
            () => true,
            () => false,
          );
          if (!clicked) continue;

          const pasted = await pasteTextWithClipboard(page, normalizedValue).catch(() => false);
          let filled = pasted || await target.fill(normalizedValue, { timeout: 3000 }).then(
            () => true,
            () => false,
          );

          if (!filled) {
            filled = await page.keyboard.insertText(normalizedValue).then(() => true, () => false);
          }

          if (!filled) continue;

          console.log(`[naver-agent] filled ${label} via ${selector}${pasted ? " (clipboard paste)" : ""} after ${attempts} readiness checks`);
          return true;
        }
      }
    }

    if (Date.now() < deadline) await page.waitForTimeout(300);
  } while (Date.now() < deadline);

  console.warn(
    `[naver-agent] could not find or fill ${label} input target after 30 seconds `
    + `(checks=${attempts}, observed=${observedTargets}, url=${page.url()}, frames=${page.frames().length}).`,
  );
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
  const resumePopup = page.locator('.se-popup:visible').filter({ hasText: "작성 중인 글이 있습니다" }).last();
  if (await resumePopup.isVisible().catch(() => false)) {
    const cancelButton = resumePopup.locator("button.se-popup-button-cancel").first();
    if (await cancelButton.isVisible().catch(() => false)) {
      await cancelButton.click({ timeout: 5000 });
      console.log("[naver-agent] started a new post without restoring the previous autosaved editor session.");
      return true;
    }
  }

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

export function savedDraftTitleMatchToken(title: string) {
  const normalized = title.replace(/\s+/g, " ").trim();
  return normalized.length >= 12 ? normalized.slice(0, 32).trim() : normalized;
}

export function hasSavedDraftTitle(listText: string, title: string) {
  const token = savedDraftTitleMatchToken(title);
  return token.length >= 8 && listText.replace(/\s+/g, " ").includes(token);
}

async function fillNaverTags(page: import("playwright").Page, tags: string[]) {
  if (tags.length === 0) return true;
  const selectors = [
    'input[placeholder*="태그"]',
    'input[aria-label*="태그"]',
    'input[class*="tag"]',
  ];
  for (const selector of selectors) {
    const input = page.locator(selector).first();
    if (!(await input.count().catch(() => 0))) continue;
    await input.fill(tags.map((tag) => tag.replace(/^#/, "")).join(","), { timeout: 10000 });
    await page.keyboard.press("Enter").catch(() => undefined);
    console.log(`[naver-agent] filled ${tags.length} tags.`);
    return true;
  }
  console.warn("[naver-agent] tag input was not found.");
  return false;
}

async function verifyDraftSave(page: import("playwright").Page, expectedTitle: string) {
  await page.waitForTimeout(1000);
  const blocked = await detectBlockedStatus(page);
  if (blocked) return { ok: false, blocked };
  const bodyText = await page.locator("body").innerText({ timeout: 5000 }).catch(() => "");
  const hasSaveSignal = ["임시저장 되었습니다", "임시저장되었습니다", "저장되었습니다", "저장 완료"].some((token) => bodyText.includes(token));
  if (hasSaveSignal) {
    console.log("[naver-agent] draft save confirmed by completion message.");
    return { ok: true, blocked: null };
  }

  const savedListButton = page.locator('[aria-label*="임시저장된 글 보기"]').first();
  if (!(await savedListButton.count().catch(() => 0))) return { ok: false, blocked: null };
  if (!(await savedListButton.click({ timeout: 10000 }).then(() => true, () => false))) return { ok: false, blocked: null };
  await page.waitForTimeout(1500);
  const listText = await page.locator("body").innerText({ timeout: 5000 }).catch(() => "");
  const titleConfirmed = hasSavedDraftTitle(listText, expectedTitle);
  await dismissNaverDraftModal(page).catch(() => undefined);
  console.log(`[naver-agent] draft save title confirmation: ${titleConfirmed ? "matched" : "not_matched"}`);
  return { ok: titleConfirmed, blocked: null };
}

function naverPostIdFromUrl(value: string) {
  try {
    const url = new URL(value);
    return url.searchParams.get("logNo") || url.pathname.split("/").filter(Boolean).at(-1) || undefined;
  } catch {
    return undefined;
  }
}

function isPublishedNaverUrl(value: string, writeUrl: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:"
      && (url.hostname === "blog.naver.com" || url.hostname.endsWith(".blog.naver.com"))
      && !value.startsWith(writeUrl)
      && !url.pathname.includes("PostWriteForm");
  } catch {
    return false;
  }
}

async function clickNaverPublish(page: import("playwright").Page, writeUrl: string, tags: string[], category?: string | null) {
  const publishSelectors = [
    'button:has-text("발행")',
    '[role="button"]:has-text("발행")',
    'button[class*="publish"]',
    'a[class*="publish"]',
  ];
  let clicked = false;
  for (const selector of publishSelectors) {
    const button = page.locator(selector).first();
    if (!(await button.count().catch(() => 0))) continue;
    if (!(await button.isVisible().catch(() => false))) continue;
    await button.click({ timeout: 10000 });
    clicked = true;
    console.log(`[naver-agent] opened publish confirmation via ${selector}.`);
    break;
  }
  if (!clicked) throw new Error("NAVER_PUBLISH_BUTTON_NOT_FOUND");

  await page.waitForTimeout(1500);
  if (isPublishedNaverUrl(page.url(), writeUrl)) {
    return { publishedUrl: page.url(), naverPostId: naverPostIdFromUrl(page.url()) };
  }
  if (category?.trim()) {
    const normalizedCategory = normalizeNaverCategoryLabel(category);
    const categoryButton = page.locator('div[class*="layer_publish"] button[aria-label="카테고리 목록 버튼"]:visible').last();
    if (!(await categoryButton.count().catch(() => 0))) throw new Error("NAVER_CATEGORY_BUTTON_NOT_FOUND");
    await categoryButton.click({ timeout: 10000 });
    await page.waitForTimeout(300);
    const categoryItems = page.locator('[role="menu"]:visible li');
    let categorySelected = false;
    for (let index = 0; index < await categoryItems.count(); index += 1) {
      const item = categoryItems.nth(index);
      const itemText = normalizeNaverCategoryLabel(await item.innerText().catch(() => ""));
      if (itemText !== normalizedCategory) continue;
      await item.click({ timeout: 10000 });
      categorySelected = true;
      break;
    }
    if (!categorySelected) throw new Error(`NAVER_CATEGORY_NOT_FOUND:${category}`);
    const selectedCategory = normalizeNaverCategoryLabel(await categoryButton.innerText().catch(() => ""));
    if (selectedCategory !== normalizedCategory) {
      throw new Error(`NAVER_CATEGORY_NOT_CONFIRMED:${selectedCategory || "empty"}`);
    }
    console.log(`[naver-agent] category confirmed: ${category}`);
  }
  if (!(await fillNaverTags(page, tags))) throw new Error("NAVER_TAG_INPUT_NOT_FOUND");
  const confirmationSelectors = [
    'div[class*="layer_publish"] button[class*="confirm_btn"]',
    'button[class*="confirm_btn"]',
    'div[class*="layer_publish"] button:has-text("발행")',
    '.se-popup button:has-text("발행")',
    '[role="dialog"] button:has-text("발행")',
    'button:has-text("발행하기")',
  ];
  let confirmed = false;
  for (const selector of confirmationSelectors) {
    const confirm = page.locator(selector).last();
    if (!(await confirm.count().catch(() => 0))) continue;
    if (!(await confirm.isVisible().catch(() => false))) continue;
    await confirm.click({ timeout: 10000 });
    console.log(`[naver-agent] confirmed publish via ${selector}.`);
    confirmed = true;
    break;
  }
  if (!confirmed) throw new Error("NAVER_PUBLISH_CONFIRMATION_NOT_FOUND");

  await page.waitForTimeout(5000);
  let publishedUrl = page.url();
  if (!isPublishedNaverUrl(publishedUrl, writeUrl)) {
    const link = page.locator('a[href*="blog.naver.com"][href*="logNo"], a[href*="PostView.naver"]').first();
    publishedUrl = await link.getAttribute("href", { timeout: 5000 }).catch(() => null) ?? publishedUrl;
  }
  if (!isPublishedNaverUrl(publishedUrl, writeUrl)) throw new Error("NAVER_PUBLISHED_URL_NOT_CONFIRMED");
  return { publishedUrl, naverPostId: naverPostIdFromUrl(publishedUrl) };
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

export async function runNaverWriter(job: NaverDraftJob, context: WriterContext): Promise<WriterResult> {
  const dryRun = !isExplicitLiveMode();
  const allowDraftSave = process.env.NAVER_ALLOW_DRAFT_SAVE === "true";
  const allowImageUpload = process.env.NAVER_ALLOW_IMAGE_UPLOAD === "true" && job.allowImageUpload === true;
  const allowPublish = process.env.NAVER_ALLOW_PUBLISH === "true" && job.allowPublish === true;
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
      ".se-section-text",
      '.se-component-content [contenteditable="true"]',
      '.se-main-container [contenteditable="true"]',
      '[contenteditable="true"][data-placeholder*="내용"]',
      '[contenteditable="true"][aria-label*="본문"]',
      'div[contenteditable="true"]',
      "textarea",
    ];

    const imageManifest = validateJobImageManifest(job);
    if ((allowPublish || allowImageUpload) && !imageManifest.ok) {
      return {
        status: "image_quality_failed",
        externalUrl: page.url(),
        errorCode: "NAVER_IMAGE_QUALITY_FAILED",
        errorMessage: imageManifest.issues.join(" | "),
      };
    }

    const wantsImages = Boolean(job.thumbnailImageUrl || (job.inlineImageUrls?.length ?? 0) > 0);
    let beforeImages = 0;
    let thumbnailUploaded = false;
    const titleFilled = await fillFirstEditorTarget(page, titleSelectors, job.title, "title");
    if (titleFilled) await page.waitForTimeout(1200);
    if (!titleFilled) {
      return {
        status: allowPublish ? "readability_failed" : "user_publish_required",
        externalUrl: page.url(),
        errorCode: "NAVER_EDITOR_INPUT_NOT_FOUND",
        errorMessage: "Naver editor title input target was not found.",
      };
    }

    if (wantsImages && allowImageUpload) {
      try {
        await context.reportProgress?.({ status: "image_uploading" });
        if (!imageManifest.thumbnail || !job.thumbnailImageUrl) throw new Error("NAVER_THUMBNAIL_REQUIRED");
        beforeImages = await countNaverImages(page);
        const thumbnailFile = await downloadTrustedThumbnail({
          page,
          jobId: job.id,
          imageUrl: job.thumbnailImageUrl,
          assetBaseUrl: context.assetBaseUrl,
        });
        await uploadNaverThumbnail(page, bodySelectors, thumbnailFile);
        if (!(await insertImageCaption(page, imageManifest.thumbnail.caption, imageManifest.thumbnail.sourceLabel))) {
          throw new Error("NAVER_THUMBNAIL_CAPTION_INSERT_FAILED");
        }
        thumbnailUploaded = true;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          status: message.includes("CAPTION") ? "image_quality_failed" : "image_upload_failed",
          externalUrl: page.url(),
          errorCode: message.includes("CAPTION") ? "NAVER_IMAGE_QUALITY_FAILED" : "NAVER_IMAGE_UPLOAD_FAILED",
          errorMessage: message,
        };
      }
    } else if (allowPublish) {
      return {
        status: "image_upload_failed",
        externalUrl: page.url(),
        errorCode: "NAVER_IMAGE_UPLOAD_NOT_ALLOWED",
        errorMessage: "Automatic publish requires both server and local image upload permission.",
      };
    }

    const naverBody = prepareNaverPublicationBody(job.body);
    const articleUrls = selectNaverArticleUrls(job.body);
    const bodyFilled = await fillMultilineEditorTarget(page, bodySelectors, naverBody, "body");

    if (!bodyFilled) {
      return {
        status: allowPublish ? "readability_failed" : "user_publish_required",
        externalUrl: page.url(),
        errorCode: "NAVER_EDITOR_INPUT_NOT_FOUND",
        errorMessage: "Naver editor body input target was not found. Please paste manually in the opened browser.",
      };
    }

    const readability = await verifyNaverEditorReadability(page, naverBody);
    if (!readability.ok) {
      return {
        status: "readability_failed",
        externalUrl: page.url(),
        errorCode: "NAVER_EDITOR_READABILITY_FAILED",
        errorMessage: `Naver editor body verification failed. characters=${readability.actual.characterCount}/${readability.expected.characterCount}, lines=${readability.actual.lineCount}/${readability.expected.lineCount}. Draft save was stopped.`,
      };
    }

    if (thumbnailUploaded) {
      try {
        await removeNaverOglinkPreviews(page);
        await applyNaverArticleLinks(page, articleUrls);
        await applyNaverSectionTitles(page, naverBody);
        await applyNaverEmphasisParagraphs(page, naverBody);
        for (const [index, image] of imageManifest.bodyImages.entries()) {
          if (!(await prepareNaverInlineImagePlacement(page, image.placementAfterHeading, image.sourceLabel))) {
            throw new Error(`NAVER_IMAGE_PLACEMENT_HEADING_NOT_FOUND_${image.id}`);
          }
          const inlineFile = await downloadTrustedThumbnail({
            page,
            jobId: job.id,
            imageUrl: image.imageUrl,
            assetBaseUrl: context.assetBaseUrl,
            fileStem: `inline-${index + 1}`,
          });
          await attachNaverImage(page, inlineFile, `inline-${index + 1}`);
          if (!(await insertImageCaption(page, image.caption, image.sourceLabel, false))) {
            throw new Error(`NAVER_IMAGE_CAPTION_INSERT_FAILED_${image.id}`);
          }
        }
        const afterImages = await countNaverImages(page);
        if (afterImages !== beforeImages + 1 + imageManifest.bodyImages.length) {
          throw new Error(`NAVER_IMAGE_TOTAL_COUNT_MISMATCH_${beforeImages}_${afterImages}`);
        }
        let placement = await verifyNaverImagePlacements(page, imageManifest.bodyImages);
        for (let attempt = 1; !placement.ok && attempt <= 4; attempt += 1) {
          console.warn(`[naver-agent] image placement verification pending (${attempt}/4): ${placement.imageId}_${placement.diagnostic}`);
          await page.waitForTimeout(1000);
          placement = await verifyNaverImagePlacements(page, imageManifest.bodyImages);
        }
        if (!placement.ok) throw new Error(`NAVER_IMAGE_PLACEMENT_VERIFY_FAILED_${placement.imageId}_${placement.diagnostic}`);
        const postImageReadability = await verifyNaverEditorReadability(page, naverBody);
        if (!postImageReadability.ok) throw new Error("NAVER_IMAGE_BODY_READABILITY_FAILED");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const qualityFailure = message.includes("PLACEMENT")
          || message.includes("CAPTION")
          || message.includes("TOTAL_COUNT")
          || message.includes("READABILITY")
          || message.includes("SECTION_TITLE")
          || message.includes("OGLINK")
          || message.includes("ARTICLE_URL")
          || message.includes("ARTICLE_LINK")
          || message.includes("EMPHASIS_PARAGRAPH");
        return {
          status: qualityFailure ? "image_quality_failed" : "image_upload_failed",
          externalUrl: page.url(),
          errorCode: qualityFailure ? "NAVER_IMAGE_QUALITY_FAILED" : "NAVER_IMAGE_UPLOAD_FAILED",
          errorMessage: message,
        };
      }
    }

    if (allowDraftSave) {
      await context.reportProgress?.({ status: "draft_saving" });
      if (!(await clickNaverEditorSave(page))) {
        await waitForNaverAutosave(page);
        return {
          status: "draft_save_failed",
          externalUrl: page.url(),
          errorCode: "NAVER_SAVE_BUTTON_NOT_FOUND",
          errorMessage: "Draft content was entered, but the Naver editor save button was not found.",
        };
      }
      const saveCheck = await verifyDraftSave(page, job.title);
      if (saveCheck.blocked) {
        return { status: saveCheck.blocked, externalUrl: page.url(), errorCode: "NAVER_SECURITY_AFTER_DRAFT_SAVE", errorMessage: "Naver security check appeared after draft save." };
      }
      if (!saveCheck.ok) {
        return { status: "draft_save_failed", externalUrl: page.url(), errorCode: "NAVER_DRAFT_SAVE_NOT_CONFIRMED", errorMessage: "Naver draft save completion was not confirmed." };
      }
      if (!allowPublish) return { status: "draft_saved", externalUrl: page.url() };

      await context.reportProgress?.({ status: "publish_ready", externalUrl: page.url() });
      const publishGate = await context.beginPublish?.();
      if (!publishGate?.allowed) {
        return {
          status: publishGate?.status === "duplicate_blocked" ? "duplicate_blocked" : "publish_blocked",
          externalUrl: page.url(),
          errorCode: publishGate?.errorCode ?? "NAVER_SERVER_PUBLISH_BLOCKED",
          errorMessage: "Server-side final duplicate/canary check blocked publishing.",
        };
      }
      try {
        const published = await clickNaverPublish(page, writeUrl, job.tags, job.category);
        return { status: "published", externalUrl: published.publishedUrl, ...published };
      } catch (error) {
        return {
          status: "publish_failed",
          externalUrl: page.url(),
          errorCode: "NAVER_PUBLISH_FAILED",
          errorMessage: error instanceof Error ? error.message : String(error),
        };
      }
    }
    return { status: "user_publish_required", externalUrl: page.url() };
  } catch (error) {
    return { status: "failed", errorCode: "NAVER_WRITER_FAILED", errorMessage: error instanceof Error ? error.message : String(error) };
  } finally {
    await contextBrowser.close().catch(() => undefined);
  }
}
