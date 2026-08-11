import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { assertPaperTradingSafe, getPaperTradingConfig } from "./paper-trading-config";
import {
  calculatePaperPositionSize,
  commissionKrw,
  entryGapPercent,
  normalizeSymbol,
  quoteIsStale,
  simulatedEntryPrice,
  simulatedExitPrice,
} from "./paper-trading-rules";
import { nextQuarterDate } from "./paper-trading-strategy";
import type {
  PaperTradingActivityDto,
  PaperTradingCycleInput,
  PaperTradingDashboard,
  PaperTradingPositionDto,
  PaperTradingResponse,
  PaperTradingRotationInput,
  PaperTradingRotationTarget,
  PaperTradingSignalInput,
  PaperTradingSystemStatus,
} from "./paper-trading-types";

const ROTATION_PLAN_PREFIX = "paper-rotation-plan:";
const ROTATION_MARK_PREFIX = "paper-rotation-mark:";
const ROTATION_PLAN_TYPE = "PaperTradingQuarterlyRotationPlan";
const ROTATION_MARK_TYPE = "PaperTradingQuarterlyMark";

function numeric(value: { toString(): string } | number | null | undefined) {
  const parsed = Number(value?.toString() ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function decimal(value: number) {
  if (!Number.isFinite(value)) throw new Error("유효하지 않은 금액입니다.");
  return value.toFixed(8);
}

function marketDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`잘못된 시장 날짜입니다: ${value}`);
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) throw new Error(`잘못된 시장 날짜입니다: ${value}`);
  return parsed;
}

function jsonRecord(value: Prisma.JsonValue | null | undefined) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, Prisma.JsonValue> : {};
}

function rotationTargets(value: Prisma.JsonValue | null | undefined): PaperTradingRotationTarget[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const row = jsonRecord(item);
    const symbol = typeof row.symbol === "string" ? normalizeSymbol(row.symbol) : "";
    if (!symbol) return [];
    return [{
      rank: Number(row.rank) || 0,
      symbol,
      name: typeof row.name === "string" ? row.name : symbol,
      sector: typeof row.sector === "string" ? row.sector : "other",
      score: Number(row.score) || 0,
      momentum6MonthPercent: Number(row.momentum6MonthPercent) || 0,
      momentum12MonthPercent: Number(row.momentum12MonthPercent) || 0,
      targetWeightPercent: Number(row.targetWeightPercent) || 10,
    }];
  }).sort((left, right) => left.rank - right.rank);
}

function validatePositive(value: number, label: string) {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${label} 값이 올바르지 않습니다.`);
}

function validateCycle(input: PaperTradingCycleInput) {
  const day = marketDate(input.marketDate);
  validatePositive(input.usdKrw, "USD/KRW");
  if (Number.isNaN(new Date(input.observedAt).getTime())) throw new Error("관측 시각이 올바르지 않습니다.");
  if (!Array.isArray(input.quotes) || !Array.isArray(input.signals)) throw new Error("시세와 신호 배열이 필요합니다.");
  for (const quote of input.quotes) {
    quote.symbol = normalizeSymbol(quote.symbol);
    if (quote.marketDate !== input.marketDate) throw new Error(`${quote.symbol} 시세 날짜가 실행 날짜와 다릅니다.`);
    for (const [label, value] of Object.entries({ open: quote.open, high: quote.high, low: quote.low, close: quote.close })) {
      validatePositive(value, `${quote.symbol} ${label}`);
    }
    if (quote.high < Math.max(quote.open, quote.close) || quote.low > Math.min(quote.open, quote.close) || quote.high < quote.low) {
      throw new Error(`${quote.symbol} OHLC 범위가 올바르지 않습니다.`);
    }
  }
  for (const signal of input.signals) {
    signal.symbol = normalizeSymbol(signal.symbol);
    validatePositive(signal.referencePriceUsd, `${signal.symbol} 기준가`);
    validatePositive(signal.stopPriceUsd, `${signal.symbol} 손절가`);
    if (signal.targetPriceUsd != null) validatePositive(signal.targetPriceUsd, `${signal.symbol} 목표가`);
    marketDate(signal.signalDate);
  }
  return day;
}

async function accountOrNull(strategyVersion = getPaperTradingConfig().strategyVersion) {
  return prisma.paperTradingAccount.findFirst({ where: { strategyVersion }, orderBy: { createdAt: "asc" } });
}

export async function initializePaperTradingAccount() {
  const config = assertPaperTradingSafe();
  const existing = await accountOrNull();
  if (existing) return getPaperTradingDashboard();
  await prisma.paperTradingAccount.create({
    data: {
      name: "미국주식 모의계좌 · 1,000만원",
      mode: "PAPER",
      externalOrderAuthorization: "NONE",
      executionVenue: "INTERNAL_VIRTUAL_BROKER",
      baseCurrency: "KRW",
      initialCapitalKrw: decimal(config.initialCapitalKrw),
      cashKrw: decimal(config.initialCapitalKrw),
      equityKrw: decimal(config.initialCapitalKrw),
      realizedPnlKrw: decimal(0),
      status: "ACTIVE",
      strategyVersion: config.strategyVersion,
      rules: config.rules,
    },
  });
  return getPaperTradingDashboard();
}

function positionDto(position: {
  id: string;
  symbol: string;
  name: string;
  strategy: string;
  quantity: number;
  entryDate: Date;
  entryPriceUsd: { toString(): string };
  lastPriceUsd: { toString(): string };
  stopPriceUsd: { toString(): string };
  targetPriceUsd: { toString(): string } | null;
}, usdKrw: number): PaperTradingPositionDto {
  const entry = numeric(position.entryPriceUsd);
  const last = numeric(position.lastPriceUsd);
  const marketValue = last * position.quantity * usdKrw;
  const unrealized = (last - entry) * position.quantity * usdKrw;
  return {
    id: position.id,
    symbol: position.symbol,
    name: position.name,
    strategy: position.strategy,
    quantity: position.quantity,
    entryDate: position.entryDate.toISOString().slice(0, 10),
    entryPriceUsd: decimal(entry),
    lastPriceUsd: decimal(last),
    stopPriceUsd: decimal(numeric(position.stopPriceUsd)),
    targetPriceUsd: position.targetPriceUsd ? decimal(numeric(position.targetPriceUsd)) : null,
    marketValueKrw: decimal(marketValue),
    unrealizedPnlKrw: decimal(unrealized),
    returnPercent: decimal(entry > 0 ? (last / entry - 1) * 100 : 0),
  };
}

export async function getPaperTradingDashboard(): Promise<PaperTradingResponse> {
  const config = getPaperTradingConfig();
  if (!config.enabled) {
    return { enabled: false, mode: "PAPER", externalOrderAuthorization: "NONE", message: "모의투자 기능이 비활성화되어 있습니다." };
  }
  if (!config.safeToRun) {
    return { enabled: false, mode: "PAPER", externalOrderAuthorization: "NONE", message: "LIVE 요청이 감지되어 모의투자 엔진을 차단했습니다." };
  }
  const account = await accountOrNull();
  if (!account) {
    return {
      enabled: true,
      mode: "PAPER",
      externalOrderAuthorization: "NONE",
      executionVenue: "INTERNAL_VIRTUAL_BROKER",
      account: null,
      rules: config.rules,
      positions: [],
      activity: [],
      counts: { openPositions: 0, ordersToday: 0, newPositionsToday: 0, rejectedSignalsToday: 0, closedTrades: 0 },
    };
  }

  const latestDay = account.lastMarketDate;
  const [positionRows, orderRows, tradeRows, riskRows, closedTrades, ordersToday, newPositionsToday, rejectedSignalsToday, latestPlan, rotationMarks] = await Promise.all([
    prisma.paperTradingPosition.findMany({ where: { accountId: account.id, status: "OPEN" }, orderBy: { symbol: "asc" } }),
    prisma.paperTradingOrder.findMany({ where: { accountId: account.id }, orderBy: { createdAt: "desc" }, take: 20 }),
    prisma.paperTradingTrade.findMany({ where: { accountId: account.id }, orderBy: { createdAt: "desc" }, take: 20 }),
    prisma.paperTradingRiskEvent.findMany({ where: { accountId: account.id }, orderBy: { createdAt: "desc" }, take: 20 }),
    prisma.paperTradingTrade.count({ where: { accountId: account.id } }),
    latestDay ? prisma.paperTradingOrder.count({ where: { accountId: account.id, marketDate: latestDay } }) : 0,
    latestDay ? prisma.paperTradingOrder.count({ where: { accountId: account.id, marketDate: latestDay, side: "BUY", status: "FILLED" } }) : 0,
    latestDay ? prisma.paperTradingSignal.count({ where: { accountId: account.id, processedAt: { gte: latestDay }, status: "REJECTED" } }) : 0,
    prisma.eventLog.findFirst({
      where: { type: ROTATION_PLAN_TYPE, id: { startsWith: `${ROTATION_PLAN_PREFIX}${account.id}:` } },
      orderBy: { timestamp: "desc" },
      select: { payload: true },
    }),
    prisma.eventLog.findMany({
      where: { type: ROTATION_MARK_TYPE, id: { startsWith: `${ROTATION_MARK_PREFIX}${account.id}:` } },
      orderBy: { timestamp: "asc" },
      select: { payload: true },
    }),
  ]);

  const usdKrw = numeric(account.usdKrw);
  const planPayload = jsonRecord(latestPlan?.payload);
  const planTargets = rotationTargets(planPayload.targets);
  const targetBySymbol = new Map(planTargets.map((target) => [target.symbol, target]));
  const positions = positionRows.map((row) => ({
    ...positionDto(row, usdKrw),
    targetRank: targetBySymbol.get(row.symbol)?.rank,
    targetWeightPercent: targetBySymbol.get(row.symbol)?.targetWeightPercent,
  }));
  const marketValueKrw = positions.reduce((sum, row) => sum + numeric(row.marketValueKrw), 0);
  const unrealizedPnlKrw = positions.reduce((sum, row) => sum + numeric(row.unrealizedPnlKrw), 0);
  const initial = numeric(account.initialCapitalKrw);
  const equity = numeric(account.equityKrw);
  const firstMark = jsonRecord(rotationMarks[0]?.payload);
  const latestMark = jsonRecord(rotationMarks.at(-1)?.payload);
  const firstSpy = Number(firstMark.spyCloseUsd);
  const latestSpy = Number(latestMark.spyCloseUsd);
  const benchmarkReturn = firstSpy > 0 && latestSpy > 0 ? (latestSpy / firstSpy - 1) * 100 : null;
  const accountReturn = initial > 0 ? (equity / initial - 1) * 100 : 0;
  const activity: PaperTradingActivityDto[] = [
    ...orderRows.map((row): PaperTradingActivityDto => ({
      id: row.id,
      type: "order",
      symbol: row.symbol,
      status: row.status,
      title: `${row.side} ${row.quantity}주 · ${row.orderType}`,
      detail: row.decisionReason ?? `${row.filledPriceUsd ? `$${numeric(row.filledPriceUsd).toFixed(2)}` : "체결 대기"}`,
      occurredAt: row.createdAt.toISOString(),
    })),
    ...tradeRows.map((row): PaperTradingActivityDto => ({
      id: row.id,
      type: "trade",
      symbol: row.symbol,
      status: row.exitReason,
      title: `${row.symbol} 거래 종료`,
      detail: `순손익 ${Math.round(numeric(row.netPnlKrw)).toLocaleString("ko-KR")}원 · ${numeric(row.returnPercent).toFixed(2)}%`,
      occurredAt: row.createdAt.toISOString(),
    })),
    ...riskRows.map((row): PaperTradingActivityDto => ({
      id: row.id,
      type: "risk",
      symbol: row.symbol,
      status: row.severity,
      title: row.type,
      detail: row.message,
      occurredAt: row.createdAt.toISOString(),
    })),
  ].sort((left, right) => right.occurredAt.localeCompare(left.occurredAt)).slice(0, 30);

  return {
    enabled: true,
    mode: "PAPER",
    externalOrderAuthorization: "NONE",
    executionVenue: "INTERNAL_VIRTUAL_BROKER",
    account: {
      id: account.id,
      name: account.name,
      baseCurrency: "KRW",
      initialCapitalKrw: decimal(initial),
      cashKrw: decimal(numeric(account.cashKrw)),
      equityKrw: decimal(equity),
      marketValueKrw: decimal(marketValueKrw),
      realizedPnlKrw: decimal(numeric(account.realizedPnlKrw)),
      unrealizedPnlKrw: decimal(unrealizedPnlKrw),
      totalReturnPercent: decimal(initial > 0 ? (equity / initial - 1) * 100 : 0),
      status: account.status as PaperTradingSystemStatus,
      lastMarketDate: account.lastMarketDate?.toISOString().slice(0, 10) ?? null,
      lastRunAt: account.lastRunAt?.toISOString() ?? null,
      usdKrw: account.usdKrw ? decimal(usdKrw) : null,
    },
    rules: config.rules,
    positions,
    activity,
    counts: { openPositions: positions.length, ordersToday, newPositionsToday, rejectedSignalsToday, closedTrades },
    strategy: planTargets.length ? {
      key: "blend_quarterly",
      name: "6·12개월 상대 모멘텀 분기 로테이션",
      quarterKey: typeof planPayload.quarterKey === "string" ? planPayload.quarterKey : "",
      signalDate: typeof planPayload.signalDate === "string" ? planPayload.signalDate : "",
      nextRebalanceDate: nextQuarterDate(account.lastMarketDate?.toISOString().slice(0, 10) ?? new Date().toISOString().slice(0, 10)),
      targetWeightPercent: Number(planPayload.targetWeightPercent) || 10,
      cashTargetPercent: Number(planPayload.cashTargetPercent) || 20,
      universeSize: Number(planPayload.universeSize) || 0,
      targets: planTargets,
      benchmarkSymbol: "SPY",
      benchmarkReturnPercent: benchmarkReturn == null ? null : decimal(benchmarkReturn),
      excessReturnPercent: benchmarkReturn == null ? null : decimal(accountReturn - benchmarkReturn),
      startMode: planPayload.startMode === "QUARTER_START" ? "QUARTER_START" : "MID_QUARTER_BASELINE",
    } : undefined,
  } satisfies PaperTradingDashboard;
}

export async function setPaperTradingStatus(nextStatus: PaperTradingSystemStatus) {
  assertPaperTradingSafe();
  const account = await accountOrNull();
  if (!account) throw new Error("먼저 모의계좌를 시작하세요.");
  if (account.status === "KILLED" && nextStatus !== "KILLED") throw new Error("KILLED 상태는 UI에서 다시 활성화할 수 없습니다.");
  if (!(["ACTIVE", "PAUSED", "KILLED"] as const).includes(nextStatus)) throw new Error("지원하지 않는 상태입니다.");
  await prisma.paperTradingAccount.update({ where: { id: account.id }, data: { status: nextStatus } });
  await prisma.paperTradingRiskEvent.create({
    data: {
      accountId: account.id,
      type: nextStatus === "KILLED" ? "KILL_SWITCH_TRIGGERED" : "SYSTEM_STATUS_CHANGED",
      severity: nextStatus === "ACTIVE" ? "info" : nextStatus === "PAUSED" ? "warning" : "high",
      message: `모의투자 상태가 ${nextStatus}(으)로 변경되었습니다. 외부 주문 권한은 계속 NONE입니다.`,
      details: { previousStatus: account.status, nextStatus },
    },
  });
  return getPaperTradingDashboard();
}

async function rejectSignal(db: Prisma.TransactionClient, accountId: string, signal: PaperTradingSignalInput, reason: string) {
  await db.paperTradingSignal.create({
    data: {
      accountId,
      externalSignalId: signal.id,
      symbol: signal.symbol,
      name: signal.name,
      strategy: signal.strategy,
      strategyVersion: signal.strategyVersion,
      signalDate: marketDate(signal.signalDate),
      referencePriceUsd: decimal(signal.referencePriceUsd),
      stopPriceUsd: decimal(signal.stopPriceUsd),
      targetPriceUsd: signal.targetPriceUsd == null ? null : decimal(signal.targetPriceUsd),
      score: decimal(signal.score),
      reasons: signal.reasons,
      status: "REJECTED",
      decisionReason: reason,
    },
  });
  await db.paperTradingRiskEvent.create({
    data: { accountId, symbol: signal.symbol, type: reason, severity: "warning", message: `${signal.symbol} 신호를 거절했습니다: ${reason}` },
  });
}

function isQuarterStartWindow(value: string) {
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  return [1, 4, 7, 10].includes(month) && day <= 7;
}

async function runQuarterlyMomentumCycle(input: PaperTradingCycleInput, rotation: PaperTradingRotationInput) {
  const config = assertPaperTradingSafe();
  const day = marketDate(input.marketDate);
  const account = await accountOrNull();
  if (!account) throw new Error("Paper account must be initialized first.");
  const quotes = new Map(input.quotes.map((quote) => [normalizeSymbol(quote.symbol), quote]));
  const benchmarkQuote = quotes.get(rotation.benchmarkSymbol);
  if (!benchmarkQuote) throw new Error("PAPER_BENCHMARK_QUOTE_MISSING");
  const planId = `${ROTATION_PLAN_PREFIX}${account.id}:${rotation.quarterKey}`;
  const fxSlippageRate = (config.rules.fxSlippageBps ?? 10) / 10_000;

  await prisma.$transaction(async (tx) => {
    let cashKrw = numeric(account.cashKrw);
    let realizedPnlKrw = numeric(account.realizedPnlKrw);
    const storedPlan = await tx.eventLog.findUnique({ where: { id: planId }, select: { payload: true } });
    let targets = rotation.targets;
    let planCreated = false;
    if (storedPlan) {
      const savedTargets = rotationTargets(jsonRecord(storedPlan.payload).targets);
      if (savedTargets.length) targets = savedTargets;
    } else {
      if (!targets.length) throw new Error("PAPER_ROTATION_TARGETS_EMPTY");
      planCreated = true;
      await tx.eventLog.create({
        data: {
          id: planId,
          type: ROTATION_PLAN_TYPE,
          summary: `${rotation.quarterKey} quarterly momentum target plan locked`,
          payload: {
            accountId: account.id,
            strategyKey: rotation.strategyKey,
            strategyVersion: account.strategyVersion,
            quarterKey: rotation.quarterKey,
            signalDate: rotation.signalDate,
            targetWeightPercent: rotation.targetWeightPercent,
            cashTargetPercent: rotation.cashTargetPercent,
            universeSize: rotation.universeSize,
            targets,
            benchmarkSymbol: rotation.benchmarkSymbol,
            startMode: account.lastMarketDate || isQuarterStartWindow(input.marketDate) ? "QUARTER_START" : "MID_QUARTER_BASELINE",
            externalOrderAuthorization: "NONE",
          },
        },
      });
    }

    const targetBySymbol = new Map(targets.map((target) => [target.symbol, target]));
    let positions = await tx.paperTradingPosition.findMany({ where: { accountId: account.id, status: "OPEN" } });

    // A locked quarterly plan has no intraperiod stop or target exit. Prices are marked daily.
    for (const position of positions) {
      const quote = quotes.get(position.symbol);
      if (!quote || quoteIsStale(quote.observedAt, input.observedAt, config.rules.staleAfterHours)) {
        await tx.paperTradingRiskEvent.create({
          data: { accountId: account.id, symbol: position.symbol, type: "STALE_OR_MISSING_PRICE", severity: "warning", message: "Quarterly position was retained because its read-only market price was unavailable." },
        });
        continue;
      }
      await tx.paperTradingPosition.update({
        where: { id: position.id },
        data: { lastPriceUsd: decimal(quote.close), highestCloseUsd: decimal(Math.max(numeric(position.highestCloseUsd), quote.close)) },
      });
    }

    // Constituents leave only when a newly locked quarter plan removes them.
    if (planCreated) {
      for (const position of positions) {
        if (targetBySymbol.has(position.symbol)) continue;
        const quote = quotes.get(position.symbol);
        if (!quote) continue;
        const exitPrice = simulatedExitPrice(quote.open, config.rules.slippageBps);
        const notionalKrw = exitPrice * position.quantity * input.usdKrw;
        const executionCostKrw = commissionKrw(notionalKrw, config.rules.commissionBps) + notionalKrw * fxSlippageRate;
        const grossPnlKrw = (exitPrice - numeric(position.entryPriceUsd)) * position.quantity * input.usdKrw;
        const netPnlKrw = grossPnlKrw - numeric(position.entryCommissionKrw) - executionCostKrw;
        const order = await tx.paperTradingOrder.create({
          data: {
            accountId: account.id,
            idempotencyKey: `paper:${account.id}:${rotation.quarterKey}:${position.symbol}:ROTATE_SELL`,
            symbol: position.symbol,
            side: "SELL",
            orderType: "MARKET",
            status: "FILLED",
            quantity: position.quantity,
            requestedPriceUsd: decimal(quote.open),
            filledPriceUsd: decimal(exitPrice),
            decisionReason: "QUARTERLY_ROTATION_EXIT",
            marketDate: day,
            filledAt: new Date(input.observedAt),
          },
        });
        await tx.paperTradingFill.create({
          data: {
            accountId: account.id, orderId: order.id, symbol: position.symbol, side: "SELL", quantity: position.quantity,
            priceUsd: decimal(exitPrice), usdKrw: decimal(input.usdKrw), notionalKrw: decimal(notionalKrw),
            commissionKrw: decimal(executionCostKrw), slippageBps: decimal(config.rules.slippageBps), filledAt: new Date(input.observedAt),
          },
        });
        await tx.paperTradingTrade.create({
          data: {
            accountId: account.id, symbol: position.symbol, name: position.name, strategy: position.strategy,
            strategyVersion: position.strategyVersion, quantity: position.quantity, entryDate: position.entryDate,
            entryPriceUsd: position.entryPriceUsd, exitDate: day, exitPriceUsd: decimal(exitPrice), exitReason: "QUARTERLY_ROTATION",
            grossPnlKrw: decimal(grossPnlKrw), netPnlKrw: decimal(netPnlKrw),
            returnPercent: decimal((exitPrice / numeric(position.entryPriceUsd) - 1) * 100),
            entryCommissionKrw: position.entryCommissionKrw, exitCommissionKrw: decimal(executionCostKrw),
          },
        });
        await tx.paperTradingPosition.update({ where: { id: position.id }, data: { status: "CLOSED", lastPriceUsd: decimal(exitPrice), closedAt: new Date(input.observedAt) } });
        cashKrw += notionalKrw - executionCostKrw;
        realizedPnlKrw += netPnlKrw;
      }
    }

    positions = await tx.paperTradingPosition.findMany({ where: { accountId: account.id, status: "OPEN" } });
    const openSymbols = new Set(positions.map((position) => position.symbol));
    const openingMarketValueKrw = positions.reduce((sum, position) => {
      const quote = quotes.get(position.symbol);
      return sum + (quote?.open ?? numeric(position.lastPriceUsd)) * position.quantity * input.usdKrw;
    }, 0);
    const openingEquityKrw = cashKrw + openingMarketValueKrw;
    let currentExposureKrw = openingMarketValueKrw;
    let newPositionsToday = await tx.paperTradingOrder.count({ where: { accountId: account.id, marketDate: day, side: "BUY", status: "FILLED" } });

    for (const target of targets) {
      if (openSymbols.has(target.symbol) || newPositionsToday >= config.rules.maxNewPositionsPerDay) continue;
      if (openSymbols.size >= config.rules.maxOpenPositions) break;
      const quote = quotes.get(target.symbol);
      if (!quote || quoteIsStale(quote.observedAt, input.observedAt, config.rules.staleAfterHours)) continue;
      const entryPrice = simulatedEntryPrice(quote.open, config.rules.slippageBps);
      const targetBudgetKrw = openingEquityKrw * target.targetWeightPercent / 100;
      const remainingExposureKrw = Math.max(0, openingEquityKrw * config.rules.maxTotalExposurePercent - currentExposureKrw);
      const availableKrw = Math.min(targetBudgetKrw, remainingExposureKrw, cashKrw);
      const perShareKrw = entryPrice * input.usdKrw;
      const quantity = Math.floor(availableKrw / (perShareKrw * (1 + config.rules.commissionBps / 10_000 + fxSlippageRate)));
      if (quantity <= 0) continue;
      const notionalKrw = perShareKrw * quantity;
      const executionCostKrw = commissionKrw(notionalKrw, config.rules.commissionBps) + notionalKrw * fxSlippageRate;
      const externalSignalId = `${account.strategyVersion}:${rotation.quarterKey}:${target.symbol}`;
      const signalRow = await tx.paperTradingSignal.create({
        data: {
          accountId: account.id, externalSignalId, symbol: target.symbol, name: target.name,
          strategy: "QUARTERLY_RELATIVE_MOMENTUM", strategyVersion: account.strategyVersion, signalDate: marketDate(rotation.signalDate),
          referencePriceUsd: decimal(quote.open), stopPriceUsd: decimal(0.01), targetPriceUsd: null, score: decimal(target.score),
          reasons: [`rank ${target.rank}`, `6-1 momentum ${target.momentum6MonthPercent}%`, `12-1 momentum ${target.momentum12MonthPercent}%`, `sector ${target.sector}`],
          status: "ACCEPTED", decisionReason: "LOCKED_QUARTERLY_PLAN",
        },
      });
      const order = await tx.paperTradingOrder.create({
        data: {
          accountId: account.id, signalId: signalRow.id, idempotencyKey: `paper:${account.id}:${rotation.quarterKey}:${target.symbol}:BUY`,
          symbol: target.symbol, side: "BUY", orderType: "MARKET", status: "FILLED", quantity,
          requestedPriceUsd: decimal(quote.open), filledPriceUsd: decimal(entryPrice), decisionReason: "INTERNAL_QUARTERLY_SIMULATED_FILL",
          marketDate: day, filledAt: new Date(input.observedAt),
        },
      });
      await tx.paperTradingFill.create({
        data: {
          accountId: account.id, orderId: order.id, symbol: target.symbol, side: "BUY", quantity,
          priceUsd: decimal(entryPrice), usdKrw: decimal(input.usdKrw), notionalKrw: decimal(notionalKrw),
          commissionKrw: decimal(executionCostKrw), slippageBps: decimal(config.rules.slippageBps), filledAt: new Date(input.observedAt),
        },
      });
      await tx.paperTradingPosition.upsert({
        where: { accountId_symbol: { accountId: account.id, symbol: target.symbol } },
        create: {
          accountId: account.id, symbol: target.symbol, name: target.name, strategy: "QUARTERLY_RELATIVE_MOMENTUM",
          strategyVersion: account.strategyVersion, quantity, entryDate: day, entryPriceUsd: decimal(entryPrice),
          lastPriceUsd: decimal(quote.close), stopPriceUsd: decimal(0.01), targetPriceUsd: null,
          highestCloseUsd: decimal(quote.close), entryCommissionKrw: decimal(executionCostKrw), status: "OPEN",
        },
        update: {
          name: target.name, strategy: "QUARTERLY_RELATIVE_MOMENTUM", strategyVersion: account.strategyVersion, quantity,
          entryDate: day, entryPriceUsd: decimal(entryPrice), lastPriceUsd: decimal(quote.close), stopPriceUsd: decimal(0.01),
          targetPriceUsd: null, highestCloseUsd: decimal(quote.close), entryCommissionKrw: decimal(executionCostKrw),
          status: "OPEN", openedAt: new Date(input.observedAt), closedAt: null,
        },
      });
      cashKrw -= notionalKrw + executionCostKrw;
      currentExposureKrw += quote.close * quantity * input.usdKrw;
      openSymbols.add(target.symbol);
      newPositionsToday += 1;
    }

    positions = await tx.paperTradingPosition.findMany({ where: { accountId: account.id, status: "OPEN" } });
    const marketValueKrw = positions.reduce((sum, position) => sum + numeric(position.lastPriceUsd) * position.quantity * input.usdKrw, 0);
    const unrealizedPnlKrw = positions.reduce((sum, position) => sum + (numeric(position.lastPriceUsd) - numeric(position.entryPriceUsd)) * position.quantity * input.usdKrw - numeric(position.entryCommissionKrw), 0);
    const equityKrw = cashKrw + marketValueKrw;
    await tx.paperTradingSnapshot.upsert({
      where: { accountId_marketDate: { accountId: account.id, marketDate: day } },
      create: { accountId: account.id, marketDate: day, cashKrw: decimal(cashKrw), marketValueKrw: decimal(marketValueKrw), equityKrw: decimal(equityKrw), realizedPnlKrw: decimal(realizedPnlKrw), unrealizedPnlKrw: decimal(unrealizedPnlKrw), openPositions: positions.length, usdKrw: decimal(input.usdKrw) },
      update: { cashKrw: decimal(cashKrw), marketValueKrw: decimal(marketValueKrw), equityKrw: decimal(equityKrw), realizedPnlKrw: decimal(realizedPnlKrw), unrealizedPnlKrw: decimal(unrealizedPnlKrw), openPositions: positions.length, usdKrw: decimal(input.usdKrw), capturedAt: new Date(input.observedAt) },
    });
    await tx.paperTradingAccount.update({
      where: { id: account.id },
      data: { cashKrw: decimal(cashKrw), equityKrw: decimal(equityKrw), realizedPnlKrw: decimal(realizedPnlKrw), usdKrw: decimal(input.usdKrw), lastMarketDate: day, lastRunAt: new Date(input.observedAt) },
    });
    await tx.eventLog.upsert({
      where: { id: `${ROTATION_MARK_PREFIX}${account.id}:${input.marketDate}` },
      create: { id: `${ROTATION_MARK_PREFIX}${account.id}:${input.marketDate}`, type: ROTATION_MARK_TYPE, summary: `${input.marketDate} quarterly paper mark`, payload: { accountId: account.id, marketDate: input.marketDate, quarterKey: rotation.quarterKey, spyCloseUsd: benchmarkQuote.close, equityKrw, externalOrderAuthorization: "NONE" } },
      update: { timestamp: new Date(input.observedAt), summary: `${input.marketDate} quarterly paper mark`, payload: { accountId: account.id, marketDate: input.marketDate, quarterKey: rotation.quarterKey, spyCloseUsd: benchmarkQuote.close, equityKrw, externalOrderAuthorization: "NONE" } },
    });
  }, { isolationLevel: "Serializable", maxWait: 5_000, timeout: 30_000 });
}

export async function runPaperTradingCycle(input: PaperTradingCycleInput) {
  const config = assertPaperTradingSafe();
  const day = validateCycle(input);
  const account = await accountOrNull();
  if (!account) throw new Error("먼저 모의계좌를 시작하세요.");
  if (account.status !== "ACTIVE") {
    await prisma.paperTradingRiskEvent.create({
      data: { accountId: account.id, type: "SYSTEM_NOT_ACTIVE", severity: "warning", message: `${account.status} 상태라 실행하지 않았습니다.` },
    });
    return getPaperTradingDashboard();
  }
  if (account.lastMarketDate && day < account.lastMarketDate) throw new Error("마지막 처리일보다 이전 날짜를 실행할 수 없습니다.");
  if (account.lastMarketDate?.getTime() === day.getTime()) return getPaperTradingDashboard();

  if (input.rotation) {
    await runQuarterlyMomentumCycle(input, input.rotation);
    return getPaperTradingDashboard();
  }

  const quotes = new Map(input.quotes.map((quote) => [normalizeSymbol(quote.symbol), quote]));
  await prisma.$transaction(async (tx) => {
  let cashKrw = numeric(account.cashKrw);
  let realizedPnlKrw = numeric(account.realizedPnlKrw);
  let positions = await tx.paperTradingPosition.findMany({ where: { accountId: account.id, status: "OPEN" } });

  // Daily OHLC cannot reveal intraday ordering, so stop is checked before target.
  for (const position of positions) {
    const quote = quotes.get(position.symbol);
    if (!quote || quoteIsStale(quote.observedAt, input.observedAt, config.rules.staleAfterHours)) {
      await tx.paperTradingRiskEvent.create({
        data: { accountId: account.id, symbol: position.symbol, type: "STALE_OR_MISSING_PRICE", severity: "warning", message: "시세가 없거나 오래되어 포지션을 유지했습니다." },
      });
      continue;
    }
    const stop = numeric(position.stopPriceUsd);
    const target = numeric(position.targetPriceUsd);
    let exitReference: number | null = null;
    let exitReason = "";
    if (quote.open <= stop) { exitReference = quote.open; exitReason = "STOP_GAP"; }
    else if (quote.low <= stop) { exitReference = stop; exitReason = "STOP"; }
    else if (target > 0 && quote.high >= target) { exitReference = target; exitReason = "TARGET"; }

    if (exitReference == null) {
      await tx.paperTradingPosition.update({
        where: { id: position.id },
        data: { lastPriceUsd: decimal(quote.close), highestCloseUsd: decimal(Math.max(numeric(position.highestCloseUsd), quote.close)) },
      });
      continue;
    }

    const exitPrice = simulatedExitPrice(exitReference, config.rules.slippageBps);
    const notionalKrw = exitPrice * position.quantity * input.usdKrw;
    const exitCommissionKrw = commissionKrw(notionalKrw, config.rules.commissionBps);
    const grossPnlKrw = (exitPrice - numeric(position.entryPriceUsd)) * position.quantity * input.usdKrw;
    const netPnlKrw = grossPnlKrw - numeric(position.entryCommissionKrw) - exitCommissionKrw;
    const order = await tx.paperTradingOrder.create({
      data: {
        accountId: account.id,
        idempotencyKey: `paper:${account.id}:${input.marketDate}:${position.symbol}:${exitReason}`,
        symbol: position.symbol,
        side: "SELL",
        orderType: exitReason.startsWith("STOP") ? "STOP" : "MARKET",
        status: "FILLED",
        quantity: position.quantity,
        requestedPriceUsd: decimal(exitReference),
        filledPriceUsd: decimal(exitPrice),
        decisionReason: exitReason,
        marketDate: day,
        filledAt: new Date(input.observedAt),
      },
    });
    await tx.paperTradingFill.create({
      data: {
        accountId: account.id, orderId: order.id, symbol: position.symbol, side: "SELL", quantity: position.quantity,
        priceUsd: decimal(exitPrice), usdKrw: decimal(input.usdKrw), notionalKrw: decimal(notionalKrw),
        commissionKrw: decimal(exitCommissionKrw), slippageBps: decimal(config.rules.slippageBps), filledAt: new Date(input.observedAt),
      },
    });
    await tx.paperTradingTrade.create({
      data: {
        accountId: account.id, symbol: position.symbol, name: position.name, strategy: position.strategy,
        strategyVersion: position.strategyVersion, quantity: position.quantity, entryDate: position.entryDate,
        entryPriceUsd: position.entryPriceUsd, exitDate: day, exitPriceUsd: decimal(exitPrice), exitReason,
        grossPnlKrw: decimal(grossPnlKrw), netPnlKrw: decimal(netPnlKrw),
        returnPercent: decimal((exitPrice / numeric(position.entryPriceUsd) - 1) * 100),
        entryCommissionKrw: position.entryCommissionKrw, exitCommissionKrw: decimal(exitCommissionKrw),
      },
    });
    await tx.paperTradingPosition.update({ where: { id: position.id }, data: { status: "CLOSED", lastPriceUsd: decimal(exitPrice), closedAt: new Date(input.observedAt) } });
    cashKrw += notionalKrw - exitCommissionKrw;
    realizedPnlKrw += netPnlKrw;
  }

  positions = await tx.paperTradingPosition.findMany({ where: { accountId: account.id, status: "OPEN" } });
  let currentExposureKrw = positions.reduce((sum, position) => sum + numeric(position.lastPriceUsd) * position.quantity * input.usdKrw, 0);
  const existingSignalIds = new Set((await tx.paperTradingSignal.findMany({ where: { accountId: account.id }, select: { externalSignalId: true } })).map((row) => row.externalSignalId));
  let newPositionsToday = await tx.paperTradingOrder.count({ where: { accountId: account.id, marketDate: day, side: "BUY", status: "FILLED" } });
  const openSymbols = new Set(positions.map((position) => position.symbol));

  for (const signal of [...input.signals].sort((left, right) => right.score - left.score || left.symbol.localeCompare(right.symbol))) {
    if (existingSignalIds.has(signal.id)) {
      await tx.paperTradingRiskEvent.create({
        data: { accountId: account.id, symbol: signal.symbol, type: "DUPLICATE_REJECTED", severity: "warning", message: `이미 처리한 신호입니다: ${signal.id}` },
      });
      continue;
    }
    existingSignalIds.add(signal.id);
    const quote = quotes.get(signal.symbol);
    let reason: string | null = null;
    if (marketDate(signal.signalDate) >= day) reason = "LOOKAHEAD_OR_SAME_DAY_SIGNAL";
    else if (!quote) reason = "MISSING_PRICE";
    else if (quoteIsStale(quote.observedAt, input.observedAt, config.rules.staleAfterHours)) reason = "STALE_MARKET_DATA";
    else if (openSymbols.has(signal.symbol)) reason = "DUPLICATE_POSITION";
    else if (openSymbols.size >= config.rules.maxOpenPositions) reason = "MAX_OPEN_POSITIONS";
    else if (newPositionsToday >= config.rules.maxNewPositionsPerDay) reason = "MAX_NEW_POSITIONS_PER_DAY";
    else if (entryGapPercent(signal.referencePriceUsd, quote.open) > config.rules.maximumEntryGapPercent) reason = "ABNORMAL_ENTRY_GAP";
    if (reason) { await rejectSignal(tx, account.id, signal, reason); continue; }

    const entryPrice = simulatedEntryPrice(quote!.open, config.rules.slippageBps);
    const size = calculatePaperPositionSize({
      equityKrw: numeric(account.equityKrw), cashKrw, currentExposureKrw, entryPriceUsd: entryPrice,
      stopPriceUsd: signal.stopPriceUsd, usdKrw: input.usdKrw, rules: config.rules,
    });
    if (!size.quantity) { await rejectSignal(tx, account.id, signal, size.reason ?? "POSITION_SIZE_REJECTED"); continue; }

    const notionalKrw = entryPrice * size.quantity * input.usdKrw;
    const entryCommissionKrw = commissionKrw(notionalKrw, config.rules.commissionBps);
    if (notionalKrw + entryCommissionKrw > cashKrw) { await rejectSignal(tx, account.id, signal, "INSUFFICIENT_CASH"); continue; }
    const signalRow = await tx.paperTradingSignal.create({
      data: {
        accountId: account.id, externalSignalId: signal.id, symbol: signal.symbol, name: signal.name,
        strategy: signal.strategy, strategyVersion: signal.strategyVersion, signalDate: marketDate(signal.signalDate),
        referencePriceUsd: decimal(signal.referencePriceUsd), stopPriceUsd: decimal(signal.stopPriceUsd),
        targetPriceUsd: signal.targetPriceUsd == null ? null : decimal(signal.targetPriceUsd), score: decimal(signal.score),
        reasons: signal.reasons, status: "ACCEPTED", decisionReason: "PAPER_RISK_ACCEPTED",
      },
    });
    const order = await tx.paperTradingOrder.create({
      data: {
        accountId: account.id, signalId: signalRow.id, idempotencyKey: `paper:${account.id}:${signal.id}:BUY`, symbol: signal.symbol,
        side: "BUY", orderType: "MARKET", status: "FILLED", quantity: size.quantity,
        requestedPriceUsd: decimal(quote!.open), filledPriceUsd: decimal(entryPrice), decisionReason: "INTERNAL_SIMULATED_FILL",
        marketDate: day, filledAt: new Date(input.observedAt),
      },
    });
    await tx.paperTradingFill.create({
      data: {
        accountId: account.id, orderId: order.id, symbol: signal.symbol, side: "BUY", quantity: size.quantity,
        priceUsd: decimal(entryPrice), usdKrw: decimal(input.usdKrw), notionalKrw: decimal(notionalKrw),
        commissionKrw: decimal(entryCommissionKrw), slippageBps: decimal(config.rules.slippageBps), filledAt: new Date(input.observedAt),
      },
    });
    await tx.paperTradingPosition.upsert({
      where: { accountId_symbol: { accountId: account.id, symbol: signal.symbol } },
      create: {
        accountId: account.id, symbol: signal.symbol, name: signal.name, strategy: signal.strategy,
        strategyVersion: signal.strategyVersion, quantity: size.quantity, entryDate: day, entryPriceUsd: decimal(entryPrice),
        lastPriceUsd: decimal(quote!.close), stopPriceUsd: decimal(signal.stopPriceUsd),
        targetPriceUsd: signal.targetPriceUsd == null ? null : decimal(signal.targetPriceUsd), highestCloseUsd: decimal(quote!.close),
        entryCommissionKrw: decimal(entryCommissionKrw), status: "OPEN",
      },
      update: {
        name: signal.name, strategy: signal.strategy, strategyVersion: signal.strategyVersion, quantity: size.quantity,
        entryDate: day, entryPriceUsd: decimal(entryPrice), lastPriceUsd: decimal(quote!.close),
        stopPriceUsd: decimal(signal.stopPriceUsd), targetPriceUsd: signal.targetPriceUsd == null ? null : decimal(signal.targetPriceUsd),
        highestCloseUsd: decimal(quote!.close), entryCommissionKrw: decimal(entryCommissionKrw), status: "OPEN", openedAt: new Date(), closedAt: null,
      },
    });
    cashKrw -= notionalKrw + entryCommissionKrw;
    currentExposureKrw += quote!.close * size.quantity * input.usdKrw;
    openSymbols.add(signal.symbol);
    newPositionsToday += 1;
  }

  positions = await tx.paperTradingPosition.findMany({ where: { accountId: account.id, status: "OPEN" } });
  const marketValueKrw = positions.reduce((sum, position) => sum + numeric(position.lastPriceUsd) * position.quantity * input.usdKrw, 0);
  const unrealizedPnlKrw = positions.reduce((sum, position) => sum + (numeric(position.lastPriceUsd) - numeric(position.entryPriceUsd)) * position.quantity * input.usdKrw - numeric(position.entryCommissionKrw), 0);
  const equityKrw = cashKrw + marketValueKrw;
  await tx.paperTradingSnapshot.upsert({
    where: { accountId_marketDate: { accountId: account.id, marketDate: day } },
    create: {
      accountId: account.id, marketDate: day, cashKrw: decimal(cashKrw), marketValueKrw: decimal(marketValueKrw),
      equityKrw: decimal(equityKrw), realizedPnlKrw: decimal(realizedPnlKrw), unrealizedPnlKrw: decimal(unrealizedPnlKrw),
      openPositions: positions.length, usdKrw: decimal(input.usdKrw),
    },
    update: {
      cashKrw: decimal(cashKrw), marketValueKrw: decimal(marketValueKrw), equityKrw: decimal(equityKrw),
      realizedPnlKrw: decimal(realizedPnlKrw), unrealizedPnlKrw: decimal(unrealizedPnlKrw), openPositions: positions.length,
      usdKrw: decimal(input.usdKrw), capturedAt: new Date(),
    },
  });
  await tx.paperTradingAccount.update({
    where: { id: account.id },
    data: { cashKrw: decimal(cashKrw), equityKrw: decimal(equityKrw), realizedPnlKrw: decimal(realizedPnlKrw), usdKrw: decimal(input.usdKrw), lastMarketDate: day, lastRunAt: new Date(input.observedAt) },
  });
  }, { isolationLevel: "Serializable", maxWait: 5_000, timeout: 30_000 });
  return getPaperTradingDashboard();
}
