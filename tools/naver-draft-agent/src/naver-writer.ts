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
  disclaimer: string | null;
};

type WriterResult = {
  status: "draft_saved" | "user_publish_required" | "failed" | "login_required" | "captcha_required" | "security_check_required";
  externalUrl?: string;
  errorCode?: string;
  errorMessage?: string;
};

function classifySecurityPage(url: string, text: string): WriterResult["status"] | null {
  const haystack = `${url}\n${text}`.toLowerCase();
  if (["captcha", "\uc790\ub3d9\uc785\ub825", "\ub85c\ubd07"].some((token) => haystack.includes(token))) return "captcha_required";
  if (["2fa", "two-factor", "\ubcf4\uc548", "security", "\uc778\uc99d"].some((token) => haystack.includes(token))) return "security_check_required";
  if (["login", "\ub85c\uadf8\uc778", "signin", "sign in"].some((token) => haystack.includes(token))) return "login_required";
  return null;
}

export async function runNaverWriter(job: NaverDraftJob, context: { draftFile: string }): Promise<WriterResult> {
  const dryRun = process.env.NAVER_AGENT_DRY_RUN !== "false";
  const allowDraftSave = process.env.NAVER_ALLOW_DRAFT_SAVE === "true";
  if (dryRun) {
    return {
      status: "draft_saved",
      externalUrl: `dry-run://${context.draftFile}`,
    };
  }

  const writeUrl = process.env.NAVER_BLOG_WRITE_URL?.trim() || "https://blog.naver.com/PostWriteForm.naver";
  const profileDir = process.env.NAVER_BROWSER_PROFILE_DIR?.trim() || "./.naver-profile";

  const { chromium } = await import("playwright");
  const contextBrowser = await chromium.launchPersistentContext(profileDir, {
    headless: false,
    viewport: { width: 1440, height: 900 },
  });
  const page = contextBrowser.pages()[0] ?? await contextBrowser.newPage();

  try {
    await page.goto(writeUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
    const bodyText = await page.locator("body").innerText({ timeout: 10000 }).catch(() => "");
    const blockedStatus = classifySecurityPage(page.url(), bodyText);
    if (blockedStatus) {
      return { status: blockedStatus, errorCode: "NAVER_LOGIN_OR_SECURITY_REQUIRED", errorMessage: "Naver login/security verification is required in the local browser." };
    }

    const titleSelectors = ["input[placeholder*=제목]", "textarea[placeholder*=제목]", "input.se-title-input", "textarea.se-title-input"];
    for (const selector of titleSelectors) {
      const target = page.locator(selector).first();
      if (await target.count().catch(() => 0)) {
        await target.fill(job.title).catch(() => undefined);
        break;
      }
    }

    const bodySelectors = ["div[contenteditable=true]", "textarea", ".se-component-content"];
    for (const selector of bodySelectors) {
      const target = page.locator(selector).first();
      if (await target.count().catch(() => 0)) {
        await target.click().catch(() => undefined);
        await page.keyboard.insertText(job.body).catch(() => undefined);
        break;
      }
    }

    if (allowDraftSave) {
      const saveButton = page.getByText(/임시저장|저장/).first();
      if (await saveButton.count().catch(() => 0)) {
        await saveButton.click({ timeout: 10000 }).catch(() => undefined);
        return { status: "draft_saved", externalUrl: page.url() };
      }
      return { status: "user_publish_required", externalUrl: page.url(), errorCode: "NAVER_SAVE_BUTTON_NOT_FOUND", errorMessage: "Draft content was entered, but the save button was not found." };
    }

    return { status: "user_publish_required", externalUrl: page.url() };
  } catch (error) {
    return { status: "failed", errorCode: "NAVER_WRITER_FAILED", errorMessage: error instanceof Error ? error.message : String(error) };
  }
}
