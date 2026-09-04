import { existsSync, readFileSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:net";
import path from "node:path";
import { runNaverWriter, testNaverBrowser, type NaverDraftJob } from "./naver-writer.js";
import { getScheduledPublishWaitMs, nextPublishHeartbeatDelay } from "./publish-schedule.js";

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

async function writeAgentState(cfg: AgentConfig, input: {
  jobId?: string | null;
  status: string;
  publishing?: boolean;
}) {
  try {
    const file = path.resolve(process.env.NAVER_AGENT_STATE_FILE?.trim() || "logs/naver-draft-agent-state.json");
    await mkdir(path.dirname(file), { recursive: true });
    const temporaryFile = `${file}.${process.pid}.tmp`;
    await writeFile(temporaryFile, JSON.stringify({
      timestamp: new Date().toISOString(),
      processId: process.pid,
      agentId: cfg.agentId,
      buildSha: process.env.BG_COMPANY_BUILD_SHA ?? process.env.NAVER_AGENT_BUILD_SHA ?? null,
      jobId: input.jobId ?? null,
      status: input.status,
      publishing: input.publishing === true,
    }), "utf8");
    await rename(temporaryFile, file);
  } catch (error) {
    console.error("[naver-agent] state heartbeat warning", error instanceof Error ? error.message : error);
  }
}

async function waitForScheduledPublish(
  cfg: AgentConfig,
  job: NaverDraftJob,
) {
  let waitMs = getScheduledPublishWaitMs(job.publishNotBefore);
  if (waitMs > 0) {
    console.log(`[naver-agent] ${job.id} prepared; waiting until ${job.publishNotBefore}`);
  }
  while (waitMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, nextPublishHeartbeatDelay(waitMs)));
    waitMs = getScheduledPublishWaitMs(job.publishNotBefore);
    if (waitMs > 0) await reportStatus(cfg, job.id, { status: "publish_ready" });
  }
}

async function processJob(cfg: AgentConfig, job: NaverDraftJob) {
  console.log(`[naver-agent] claiming ${job.id}`);
  const claimed = await claimJob(cfg, job.id);
  await writeAgentState(cfg, { jobId: claimed.job.id, status: "claimed" });
  await reportStatus(cfg, claimed.job.id, { status: "in_progress" });
  const draftFile = await saveLocalDraft(claimed.job);
  const result = await runNaverWriter(claimed.job, {
    draftFile,
    assetBaseUrl: cfg.baseUrl,
    reportProgress: async (body) => {
      const response = await reportStatus(cfg, claimed.job.id, body);
      await writeAgentState(cfg, {
        jobId: claimed.job.id,
        status: response.job.status ?? String(body.status ?? "in_progress"),
        publishing: response.job.status === "publishing",
      });
    },
    beginPublish: async () => {
      await waitForScheduledPublish(cfg, claimed.job);
      for (let attempt = 0; attempt < 60; attempt += 1) {
        const response = await reportStatus(cfg, claimed.job.id, { status: "publishing" });
        await writeAgentState(cfg, {
          jobId: claimed.job.id,
          status: response.job.status ?? "publish_blocked",
          publishing: response.job.status === "publishing",
        });
        const errorCode = response.job.errorCode;
        if (response.job.status === "publish_ready" && errorCode === "NAVER_PUBLISH_CIRCUIT_BREAKER_ACTIVE") {
          return { allowed: false, status: "publish_ready", errorCode };
        }
        if (response.job.status !== "publish_ready") {
          return {
            allowed: response.job.status === "publishing",
            status: response.job.status ?? "publish_blocked",
            errorCode,
          };
        }
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
      return { allowed: false, status: "publish_ready", errorCode: "NAVER_PUBLISH_NOT_DUE" };
    },
  });
  const reported = await reportStatus(cfg, claimed.job.id, result);
  await writeAgentState(cfg, { jobId: claimed.job.id, status: reported.job.status ?? result.status });
  console.log(`[naver-agent] ${claimed.job.id} -> ${result.status}`);
}

function singletonPort() {
  const parsed = Number.parseInt(process.env.NAVER_AGENT_SINGLETON_PORT ?? "43923", 10);
  return Number.isFinite(parsed) && parsed >= 1024 && parsed <= 65535 ? parsed : 43923;
}

async function acquireSingletonLock(): Promise<Server> {
  const port = singletonPort();
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen({ host: "127.0.0.1", port, exclusive: true }, () => {
      server.off("error", reject);
      resolve();
    });
  }).catch((error: NodeJS.ErrnoException) => {
    server.close();
    if (error.code === "EADDRINUSE") throw new Error(`NAVER_AGENT_ALREADY_RUNNING:${port}`);
    throw error;
  });
  console.log(`[naver-agent] singleton lock acquired on 127.0.0.1:${port}`);
  return server;
}

async function main() {
  const cfg = config();
  if (process.argv.includes("--browser-test")) {
    await testNaverBrowser();
    return;
  }
  const singletonLock = await acquireSingletonLock();
  await writeAgentState(cfg, { status: "idle" });
  console.log(`[naver-agent] polling ${cfg.baseUrl} every ${cfg.pollIntervalMs}ms`);
  const dryRunSetting = process.env.NAVER_AGENT_DRY_RUN ?? process.env.NAVER_DRAFT_AGENT_DRY_RUN;
  const singleJob = process.env.NAVER_AGENT_SINGLE_JOB === "true";
  console.log(`[naver-agent] dry-run=${dryRunSetting !== "false"}, save=${process.env.NAVER_ALLOW_DRAFT_SAVE === "true"}, publish=${process.env.NAVER_ALLOW_PUBLISH === "true"}`);
  try {
    for (;;) {
      let attemptedJob = false;
      try {
        const { job } = await nextJob(cfg);
        if (job) {
          attemptedJob = true;
          await processJob(cfg, job);
          if (singleJob) return;
        }
      } catch (error) {
        console.error("[naver-agent]", error instanceof Error ? error.message : error);
        if (singleJob && attemptedJob) return;
      }
      await new Promise((resolve) => setTimeout(resolve, cfg.pollIntervalMs));
    }
  } finally {
    singletonLock.close();
  }
}

void main().catch((error) => {
  console.error("[naver-agent]", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
