import "server-only";
import { timingSafeEqual } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  evaluatePortfolioAutoSyncRun,
  getPortfolioAutoSyncConfig,
  getPortfolioSchedule,
  type PortfolioAutoSyncConfig,
} from "./portfolio-sync-scheduler-policy";

const EVENT_TYPE = "PortfolioDailyAccountSync";
const EVENT_PREFIX = "event-portfolio-daily-sync-";

export type PortfolioDailySyncExecution = {
  accountId: string;
  accountSyncedAt: string;
  priceRefreshedAt: string | null;
  snapshotDate: string;
  created: number;
  updated: number;
  deactivated: number;
  totalCount: number;
  dailySnapshotId?: string;
};

export type PortfolioAutoSyncStatus = {
  enabled: boolean;
  cron: string;
  timezone: string;
  retryLimit: number;
  status: string;
  lastAccountSyncedAt: string | null;
  lastPriceRefreshedAt: string | null;
  changedCount: number;
  createdCount: number;
  updatedCount: number;
  deactivatedCount: number;
  nextRunAt: string;
  error: string | null;
  freshnessWarning: string | null;
  lastAttempt: number;
};

function payloadObject(value: Prisma.JsonValue | null | undefined) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, Prisma.JsonValue>
    : {};
}

function numeric(value: Prisma.JsonValue | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function text(value: Prisma.JsonValue | undefined) {
  return typeof value === "string" ? value : null;
}

function eventId(dateKey: string) {
  return `${EVENT_PREFIX}${dateKey}`;
}

function safeError(error: unknown) {
  const raw = error instanceof Error ? error.message : "알 수 없는 자동 동기화 오류";
  return raw.replace(/(secret|token|authorization|account(number)?)[=:]\s*\S+/gi, "$1=[REDACTED]").slice(0, 500);
}

async function writeEvent(input: {
  dateKey: string;
  scheduledFor: string;
  status: string;
  attempt: number;
  summary: string;
  payload?: Prisma.InputJsonObject;
}) {
  return prisma.eventLog.upsert({
    where: { id: eventId(input.dateKey) },
    create: {
      id: eventId(input.dateKey),
      type: EVENT_TYPE,
      timestamp: new Date(),
      summary: input.summary,
      payload: {
        dateKey: input.dateKey,
        scheduledFor: input.scheduledFor,
        status: input.status,
        attempt: input.attempt,
        readOnly: true,
        ...(input.payload ?? {}),
      },
    },
    update: {
      timestamp: new Date(),
      summary: input.summary,
      payload: {
        dateKey: input.dateKey,
        scheduledFor: input.scheduledFor,
        status: input.status,
        attempt: input.attempt,
        readOnly: true,
        ...(input.payload ?? {}),
      },
    },
  });
}

export async function getPortfolioAutoSyncStatus(now = new Date()): Promise<PortfolioAutoSyncStatus> {
  const config = getPortfolioAutoSyncConfig();
  const [latestRun, account, latestPrice] = await Promise.all([
    prisma.eventLog.findFirst({
      where: { type: EVENT_TYPE },
      orderBy: { timestamp: "desc" },
      select: { timestamp: true, payload: true },
    }),
    prisma.portfolioAccount.findFirst({
      where: { source: "toss", isActive: true },
      orderBy: { createdAt: "asc" },
      select: { lastSyncedAt: true },
    }),
    prisma.portfolioPriceSnapshot.findFirst({
      where: { provider: { contains: "KIS" } },
      orderBy: { collectedAt: "desc" },
      select: { collectedAt: true },
    }),
  ]);
  const payload = payloadObject(latestRun?.payload);
  const created = numeric(payload.created);
  const updated = numeric(payload.updated);
  const deactivated = numeric(payload.deactivated);
  const lastAccountSyncedAt = text(payload.accountSyncedAt) ?? account?.lastSyncedAt?.toISOString() ?? null;
  const lastPriceRefreshedAt = text(payload.priceRefreshedAt) ?? latestPrice?.collectedAt.toISOString() ?? null;
  const status = text(payload.status) ?? (config.enabled ? "waiting" : "disabled");
  const error = text(payload.error);
  const freshest = [lastAccountSyncedAt, lastPriceRefreshedAt]
    .filter((value): value is string => Boolean(value))
    .map(Date.parse)
    .filter(Number.isFinite)
    .sort((a, b) => a - b)[0];
  const stale = freshest === undefined || now.getTime() - freshest > 26 * 60 * 60 * 1000;
  const freshnessWarning = status === "failed"
    ? "자동 동기화가 실패했습니다. 마지막 정상 평가 데이터가 유지됩니다."
    : stale
      ? "계좌 또는 가격 데이터가 26시간 이상 갱신되지 않았습니다."
      : null;
  return {
    enabled: config.enabled,
    cron: config.cron,
    timezone: config.timezone,
    retryLimit: config.retryLimit,
    status,
    lastAccountSyncedAt,
    lastPriceRefreshedAt,
    changedCount: created + updated + deactivated,
    createdCount: created,
    updatedCount: updated,
    deactivatedCount: deactivated,
    nextRunAt: getPortfolioSchedule(now, config).nextRunAt.toISOString(),
    error,
    freshnessWarning,
    lastAttempt: numeric(payload.attempt),
  };
}

export async function runPortfolioAutoSyncTick(
  execute: (input: { snapshotDate: string; sourceSyncRunId: string }) => Promise<PortfolioDailySyncExecution>,
  now = new Date(),
  config: PortfolioAutoSyncConfig = getPortfolioAutoSyncConfig(),
) {
  const schedule = getPortfolioSchedule(now, config);
  const existing = await prisma.eventLog.findUnique({
    where: { id: eventId(schedule.dateKey) },
    select: { payload: true },
  });
  const existingPayload = payloadObject(existing?.payload);
  const decision = evaluatePortfolioAutoSyncRun(now, config, existing ? {
    status: text(existingPayload.status) ?? "",
    attempt: numeric(existingPayload.attempt) || 1,
  } : null);
  if (decision.action !== "run") {
    return { ok: true, status: decision.action, attempt: decision.attempt, scheduledFor: schedule.scheduledAt.toISOString() };
  }

  await writeEvent({
    dateKey: schedule.dateKey,
    scheduledFor: schedule.scheduledAt.toISOString(),
    status: "running",
    attempt: decision.attempt,
    summary: `포트폴리오 자동 동기화 ${decision.attempt}차 실행 중`,
    payload: { startedAt: now.toISOString() },
  });
  try {
    const result = await execute({ snapshotDate: schedule.dateKey, sourceSyncRunId: eventId(schedule.dateKey) });
    await writeEvent({
      dateKey: schedule.dateKey,
      scheduledFor: schedule.scheduledAt.toISOString(),
      status: "succeeded",
      attempt: decision.attempt,
      summary: `포트폴리오 자동 동기화 완료 · 변경 ${result.created + result.updated + result.deactivated}종목`,
      payload: result as unknown as Prisma.InputJsonObject,
    });
    await prisma.eventLog.upsert({
      where: { id: `event-portfolio-sync-completed-${schedule.dateKey}` },
      create: {
        id: `event-portfolio-sync-completed-${schedule.dateKey}`,
        type: "PORTFOLIO_SYNC_COMPLETED",
        summary: "토스 계좌 읽기 전용 동기화와 포트폴리오 평가 완료",
        payload: { sourceSyncRunId: eventId(schedule.dateKey), accountId: result.accountId, dailySnapshotId: result.dailySnapshotId ?? null, readOnly: true },
      },
      update: { timestamp: new Date(), summary: "토스 계좌 읽기 전용 동기화와 포트폴리오 평가 완료" },
    });
    return { ok: true, status: "succeeded" as const, attempt: decision.attempt, scheduledFor: schedule.scheduledAt.toISOString(), result };
  } catch (error) {
    const reason = safeError(error);
    await writeEvent({
      dateKey: schedule.dateKey,
      scheduledFor: schedule.scheduledAt.toISOString(),
      status: "failed",
      attempt: decision.attempt,
      summary: `포트폴리오 자동 동기화 실패 · ${decision.attempt}차`,
      payload: { error: reason, failedAt: new Date().toISOString() },
    });
    if (config.enabled) {
      await prisma.eventLog.upsert({
        where: { id: `event-portfolio-sync-failed-${schedule.dateKey}` },
        create: {
          id: `event-portfolio-sync-failed-${schedule.dateKey}`,
          type: "PORTFOLIO_SYNC_FAILED",
          summary: "토스 계좌 읽기 전용 동기화 또는 포트폴리오 평가 실패",
          payload: { sourceSyncRunId: eventId(schedule.dateKey), error: reason, readOnly: true },
        },
        update: { timestamp: new Date(), summary: "토스 계좌 읽기 전용 동기화 또는 포트폴리오 평가 실패", payload: { sourceSyncRunId: eventId(schedule.dateKey), error: reason, readOnly: true } },
      });
    }
    return { ok: false, status: "failed" as const, attempt: decision.attempt, scheduledFor: schedule.scheduledAt.toISOString(), error: reason };
  }
}

export function verifyPortfolioAutoSyncKey(value: string | null) {
  const expected = process.env.AGENT_API_KEY?.trim();
  if (!expected || !value) return false;
  const provided = Buffer.from(value);
  const configured = Buffer.from(expected);
  return provided.length === configured.length && timingSafeEqual(provided, configured);
}
