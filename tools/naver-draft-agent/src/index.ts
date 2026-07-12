import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { runNaverWriter, testNaverBrowser, type NaverDraftJob } from "./naver-writer.js";

type AgentConfig = {
  baseUrl: string;
  apiKey: string;
  pollIntervalMs: number;
  agentId: string;
};

function loadDotEnv(file = ".env") {
  try {
    if (!existsSync(file)) return;
    for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
      const index = trimmed.indexOf("=");
      const key = trimmed.slice(0, index).trim();
      const value = trimmed.slice(index + 1).trim();
      if (!process.env[key]) process.env[key] = value;
    }
  } catch {
    // env file is optional
  }
}

function config(): AgentConfig {
  loadDotEnv();
  const baseUrl = process.env.BG_COMPANY_BASE_URL?.replace(/\/$/, "") ?? "";
  const apiKey = process.env.NAVER_DRAFT_AGENT_KEY ?? "";
  if (!baseUrl) throw new Error("BG_COMPANY_BASE_URL is required");
  if (!apiKey || apiKey === "change_me") throw new Error("NAVER_DRAFT_AGENT_KEY is required");
  const pollIntervalMs = Number(process.env.POLL_INTERVAL_MS ?? "30000");
  return {
    baseUrl,
    apiKey,
    pollIntervalMs: Number.isFinite(pollIntervalMs) && pollIntervalMs >= 5000 ? pollIntervalMs : 30000,
    agentId: process.env.NAVER_DRAFT_AGENT_ID ?? `naver-draft-agent-${process.platform}`,
  };
}

async function requestJson<T>(cfg: AgentConfig, url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${cfg.baseUrl}${url}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "x-naver-draft-agent-key": cfg.apiKey,
      ...(init?.headers ?? {}),
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${response.status} ${JSON.stringify(data)}`);
  return data as T;
}

async function nextJob(cfg: AgentConfig) {
  return requestJson<{ job: NaverDraftJob | null }>(cfg, "/api/local-agents/naver-drafts/next");
}

async function claimJob(cfg: AgentConfig, jobId: string) {
  return requestJson<{ job: NaverDraftJob }>(cfg, `/api/local-agents/naver-drafts/${encodeURIComponent(jobId)}/claim`, {
    method: "POST",
    body: JSON.stringify({ agentId: cfg.agentId }),
  });
}

async function reportStatus(cfg: AgentConfig, jobId: string, body: Record<string, unknown>) {
  return requestJson<{ job: NaverDraftJob }>(cfg, `/api/local-agents/naver-drafts/${encodeURIComponent(jobId)}/status`, {
    method: "POST",
    body: JSON.stringify({ agentId: cfg.agentId, ...body }),
  });
}

async function saveLocalDraft(job: NaverDraftJob) {
  const dir = path.resolve("drafts");
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, `${job.id}.json`);
  await writeFile(file, JSON.stringify(job, null, 2), "utf8");
  return file;
}

async function processJob(cfg: AgentConfig, job: NaverDraftJob) {
  console.log(`[naver-agent] claiming ${job.id}`);
  const claimed = await claimJob(cfg, job.id);
  await reportStatus(cfg, claimed.job.id, { status: "in_progress" });
  const draftFile = await saveLocalDraft(claimed.job);
  const result = await runNaverWriter(claimed.job, { draftFile, assetBaseUrl: cfg.baseUrl });
  await reportStatus(cfg, claimed.job.id, result);
  console.log(`[naver-agent] ${claimed.job.id} -> ${result.status}`);
}

async function main() {
  const cfg = config();
  if (process.argv.includes("--browser-test")) {
    await testNaverBrowser();
    return;
  }
  console.log(`[naver-agent] polling ${cfg.baseUrl} every ${cfg.pollIntervalMs}ms`);
  const dryRunSetting = process.env.NAVER_AGENT_DRY_RUN ?? process.env.NAVER_DRAFT_AGENT_DRY_RUN;
  console.log(`[naver-agent] dry-run=${dryRunSetting !== "false"}, save=${process.env.NAVER_ALLOW_DRAFT_SAVE === "true"}`);
  for (;;) {
    try {
      const { job } = await nextJob(cfg);
      if (job) await processJob(cfg, job);
    } catch (error) {
      console.error("[naver-agent]", error instanceof Error ? error.message : error);
    }
    await new Promise((resolve) => setTimeout(resolve, cfg.pollIntervalMs));
  }
}

void main();
