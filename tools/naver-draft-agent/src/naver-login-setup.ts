import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";
import { chromium, type BrowserContext, type Page } from "playwright";

type SessionStatus =
  | "session_ready"
  | "login_required"
  | "security_check_required"
  | "captcha_required"
  | "session_unknown";

function configureWindowsUtf8Console() {
  if (process.platform !== "win32") return;
  spawnSync(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", "chcp 65001 >NUL"], {
    stdio: "ignore",
    windowsHide: true,
  });
}

function loadDotEnv(file = ".env") {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const separator = trimmed.indexOf("=");
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
}

function isNaverDomain(value: string) {
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    return hostname === "naver.com" || hostname.endsWith(".naver.com");
  } catch {
    return false;
  }
}

async function hasAnyLocator(page: Page, selectors: string[]) {
  for (const scope of [page, ...page.frames()]) {
    for (const selector of selectors) {
      if (await scope.locator(selector).count().catch(() => 0)) return true;
    }
  }
  return false;
}

async function classifySession(page: Page): Promise<SessionStatus> {
  const currentUrl = page.url();
  const lowerUrl = currentUrl.toLowerCase();
  const bodyText = await page.locator("body").innerText({ timeout: 5000 }).catch(() => "");
  const lowerText = bodyText.slice(0, 20_000).toLowerCase();

  if (
    lowerUrl.includes("captcha") ||
    ["자동입력 방지문자", "로봇이 아닙니다", "보안문자를 입력"].some((text) => lowerText.includes(text))
  ) {
    return "captcha_required";
  }

  if (
    ["deviceconfirm", "twostep", "two-factor", "securitycheck"].some((text) => lowerUrl.includes(text)) ||
    ["2단계 인증", "새로운 기기에서 로그인", "보안 확인을 위해", "본인 확인이 필요"].some((text) => lowerText.includes(text))
  ) {
    return "security_check_required";
  }

  if (
    lowerUrl.includes("nidlogin.login") ||
    lowerUrl.includes("/login") ||
    ["네이버 로그인", "로그인이 필요합니다"].some((text) => lowerText.includes(text))
  ) {
    return "login_required";
  }

  if (!isNaverDomain(currentUrl)) return "session_unknown";

  const editorVisible = await hasAnyLocator(page, [
    ".se-main-container",
    ".se-title-text",
    '[contenteditable="true"][aria-label*="제목"]',
    '[contenteditable="true"][aria-label*="본문"]',
  ]);
  const writeOrManageUrl = ["postwriteform", "blogwrite", "writeform", "blogprofile", "blogadmin", "admin.blog.naver.com"].some((text) =>
    lowerUrl.includes(text),
  );

  return editorVisible || writeOrManageUrl ? "session_ready" : "session_unknown";
}

function initialUrl() {
  const configured = (
    process.env.NAVER_BLOG_WRITE_URL?.trim() ||
    process.env.NAVER_BLOG_MANAGE_URL?.trim() ||
    "https://blog.naver.com/PostWriteForm.naver"
  );
  return isNaverDomain(configured) ? configured : "https://nid.naver.com/nidlogin.login";
}

async function run() {
  configureWindowsUtf8Console();
  loadDotEnv();

  if (!stdin.isTTY) {
    console.log("NAVER_SESSION_STATUS=session_unknown");
    console.error("NAVER_SESSION_ERROR=interactive_terminal_required");
    process.exitCode = 2;
    return;
  }

  const profileDir = path.resolve(process.env.NAVER_BROWSER_PROFILE_DIR?.trim() || "./.naver-profile");
  if (!existsSync(profileDir) || !statSync(profileDir).isDirectory()) {
    console.log("NAVER_SESSION_STATUS=session_unknown");
    console.error("NAVER_SESSION_ERROR=persistent_profile_not_found");
    process.exitCode = 2;
    return;
  }

  const executablePath = process.env.NAVER_BROWSER_EXECUTABLE_PATH?.trim();
  if (executablePath && !existsSync(executablePath)) {
    console.log("NAVER_SESSION_STATUS=session_unknown");
    console.error("NAVER_SESSION_ERROR=browser_executable_not_found");
    process.exitCode = 2;
    return;
  }

  const channel = process.env.NAVER_BROWSER_CHANNEL?.trim() || "chrome";
  let context: BrowserContext | undefined;

  try {
    context = await chromium.launchPersistentContext(profileDir, {
      headless: false,
      viewport: null,
      chromiumSandbox: true,
      timeout: 30_000,
      ...(executablePath ? { executablePath } : { channel }),
      args: ["--start-maximized"],
    });

    const page = context.pages()[0] ?? (await context.newPage());
    await page.bringToFront();
    await page.goto(initialUrl(), { waitUntil: "domcontentloaded", timeout: 60_000 });

    console.log("브라우저에서 네이버 로그인과 보안인증을 직접 완료해주세요.");
    console.log("로그인 후 BG Market Note 글쓰기 화면까지 직접 이동해주세요.");
    console.log("완료 후 이 터미널로 돌아와 Enter를 누르세요.");

    const rl = createInterface({ input: stdin, output: stdout });
    try {
      await rl.question("");
    } finally {
      rl.close();
    }

    const status = await classifySession(page);
    await context.close();
    context = undefined;
    console.log(`NAVER_SESSION_STATUS=${status}`);
    if (status !== "session_ready") process.exitCode = 2;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const profileLocked = /processsingleton|profile.*(?:use|lock)|user data directory.*use/i.test(message);
    console.log("NAVER_SESSION_STATUS=session_unknown");
    console.error(`NAVER_SESSION_ERROR=${profileLocked ? "persistent_profile_locked" : "browser_launch_failed"}`);
    process.exitCode = 2;
  } finally {
    await context?.close().catch(() => undefined);
  }
}

void run();
