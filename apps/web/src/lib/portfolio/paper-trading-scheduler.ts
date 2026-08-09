import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getPaperTradingConfig } from "./paper-trading-config";
import { prepareAutomatedPaperCycle } from "./paper-trading-market-provider";
import { initializePaperTradingAccount, runPaperTradingCycle } from "./paper-trading-service";
import {
  decidePaperTradingSchedulerRun,
  evaluatePaperTradingTrial,
  getPaperTradingSchedule,
  getPaperTradingSchedulerConfig,
} from "./paper-trading-scheduler-policy";

const EVENT_TYPE = "PaperTradingDailyAutomation";
const EVENT_PREFIX = "event-paper-trading-auto-";

function payload(value: Prisma.JsonValue | null | undefined) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, Prisma.JsonValue> : {};
}

function text(value: Prisma.JsonValue | undefined) {
  return typeof value === "string" ? value : null;
}

function number(value: Prisma.JsonValue | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function safeError(error: unknown) {
  const message = error instanceof Error ? error.message : "PAPER_AUTOMATION_FAILED";
  return message.replace(/(secret|token|authorization|appkey|appsecret)[=:]\s*\S+/gi, "$1=[REDACTED]").slice(0, 500);
}

async function saveEvent(dateKey: string, state: {
  status: string;
  attempt: number;
  scheduledFor: string;
  summary: string;
  extra?: Prisma.InputJsonObject;
}) {
  return prisma.eventLog.upsert({
    where: { id: `${EVENT_PREFIX}${dateKey}` },
    create: {
      id: `${EVENT_PREFIX}${dateKey}`,
      type: EVENT_TYPE,
      summary: state.summary,
      payload: { dateKey, status: state.status, attempt: state.attempt, scheduledFor: state.scheduledFor, brokerOrderAuthorization: "NONE", ...(state.extra ?? {}) },
    },
    update: {
      timestamp: new Date(),
      summary: state.summary,
      payload: { dateKey, status: state.status, attempt: state.attempt, scheduledFor: state.scheduledFor, brokerOrderAuthorization: "NONE", ...(state.extra ?? {}) },
    },
  });
}

export async function getPaperTradingAutomationStatus(now = new Date()) {
  const config = getPaperTradingSchedulerConfig();
  const latest = await prisma.eventLog.findFirst({ where: { type: EVENT_TYPE }, orderBy: { timestamp: "desc" }, select: { timestamp: true, payload: true } });
  const data = payload(latest?.payload);
  return {
    enabled: config.enabled,
    cron: config.cron,
    timezone: config.timezone,
    retryLimit: config.retryLimit,
    status: text(data.status) ?? (config.enabled ? "waiting" : "disabled"),
    lastRunAt: latest?.timestamp.toISOString() ?? null,
    lastMarketDate: text(data.marketDate),
    signalDate: text(data.signalDate),
    candidateCount: number(data.candidateCount),
    loadedSymbols: number(data.loadedSymbols),
    universeSize: number(data.universeSize),
    nextRunAt: getPaperTradingSchedule(now, config).nextRunAt.toISOString(),
    attempt: number(data.attempt),
    error: text(data.error),
    provider: text(data.provider) ?? "KIS_READ_ONLY",
    baselineOnly: data.baselineOnly === true,
    trialStartMarketDate: config.trialStartMarketDate,
    trialEndMarketDate: config.trialEndMarketDate,
  };
}

export async function executeAutomatedPaperTradingCycle() {
  const schedulerConfig = getPaperTradingSchedulerConfig();
  let account = await prisma.paperTradingAccount.findFirst({ orderBy: { createdAt: "asc" } });
  if (!account && schedulerConfig.autoInitialize) {
    await initializePaperTradingAccount();
    account = await prisma.paperTradingAccount.findFirst({ orderBy: { createdAt: "asc" } });
  }
  if (!account) return { status: "paused" as const, reason: "PAPER_ACCOUNT_NOT_INITIALIZED" };
  if (account.status !== "ACTIVE") return { status: account.status.toLowerCase() as "paused" | "killed", reason: `PAPER_ACCOUNT_${account.status}` };

  const prepared = await prepareAutomatedPaperCycle(getPaperTradingConfig().strategyVersion);
  const trial = evaluatePaperTradingTrial(prepared.input.marketDate, schedulerConfig);
  if (trial.action === "waiting") {
    return {
      status: "trial_waiting" as const,
      reason: `PAPER_TRIAL_STARTS_${schedulerConfig.trialStartMarketDate}`,
      marketDate: prepared.input.marketDate,
      signalDate: prepared.signalDate,
      candidateCount: 0,
      loadedSymbols: prepared.loadedSymbols,
      universeSize: prepared.universeSize,
      provider: prepared.provider,
      baselineOnly: false,
    };
  }
  const baselineOnly = account.lastMarketDate == null;
  await runPaperTradingCycle({ ...prepared.input, signals: baselineOnly ? [] : prepared.input.signals });
  if (trial.shouldPauseAfterRun) {
    await prisma.$transaction([
      prisma.paperTradingAccount.update({ where: { id: account.id }, data: { status: "PAUSED" } }),
      prisma.paperTradingRiskEvent.create({
        data: {
          accountId: account.id,
          type: "PAPER_TRIAL_COMPLETED",
          severity: "info",
          message: `Paper-only trial completed through ${prepared.input.marketDate}; account paused automatically.`,
          details: { trialStartMarketDate: schedulerConfig.trialStartMarketDate, trialEndMarketDate: schedulerConfig.trialEndMarketDate },
        },
      }),
    ]);
  }
  return {
    status: "succeeded" as const,
    marketDate: prepared.input.marketDate,
    signalDate: prepared.signalDate,
    candidateCount: baselineOnly ? 0 : prepared.candidateCount,
    detectedCandidateCount: prepared.candidateCount,
    loadedSymbols: prepared.loadedSymbols,
    universeSize: prepared.universeSize,
    provider: prepared.provider,
    baselineOnly,
    partialErrors: prepared.errors.slice(0, 10),
    trialCompleted: trial.shouldPauseAfterRun,
  };
}

export async function runPaperTradingSchedulerTick(now = new Date()) {
  const config = getPaperTradingSchedulerConfig();
  const schedule = getPaperTradingSchedule(now, config);
  const previousRow = await prisma.eventLog.findUnique({ where: { id: `${EVENT_PREFIX}${schedule.dateKey}` }, select: { payload: true } });
  const previousPayload = payload(previousRow?.payload);
  const decision = decidePaperTradingSchedulerRun({
    now,
    config,
    previous: previousRow ? { status: text(previousPayload.status) ?? "", attempt: number(previousPayload.attempt) || 1 } : null,
  });
  if (decision.action !== "run") return { ok: true, status: decision.action, attempt: decision.attempt, scheduledFor: schedule.scheduledAt.toISOString() };

  await saveEvent(schedule.dateKey, { status: "running", attempt: decision.attempt, scheduledFor: schedule.scheduledAt.toISOString(), summary: `Paper automation attempt ${decision.attempt} started` });
  try {
    const result = await executeAutomatedPaperTradingCycle();
    await saveEvent(schedule.dateKey, {
      status: result.status,
      attempt: decision.attempt,
      scheduledFor: schedule.scheduledAt.toISOString(),
      summary: result.status === "succeeded" ? `Paper automation completed for ${result.marketDate}` : `Paper automation skipped: ${result.reason}`,
      extra: result as unknown as Prisma.InputJsonObject,
    });
    return { ok: true, attempt: decision.attempt, scheduledFor: schedule.scheduledAt.toISOString(), ...result };
  } catch (error) {
    const reason = safeError(error);
    await saveEvent(schedule.dateKey, { status: "failed", attempt: decision.attempt, scheduledFor: schedule.scheduledAt.toISOString(), summary: `Paper automation failed on attempt ${decision.attempt}`, extra: { error: reason } });
    return { ok: false, status: "failed" as const, attempt: decision.attempt, scheduledFor: schedule.scheduledAt.toISOString(), error: reason };
  }
}
