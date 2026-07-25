import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  buildRuleBasedDailyBriefing,
  calculateDailyAttributions,
  detectDailyHoldingChanges,
  sumAttributions,
} from "./portfolio-daily-assistant-calculations";
import { getPortfolioDailyAssistantConfig } from "./portfolio-daily-assistant-config";
import type {
  DailyAttribution,
  DailyHoldingChange,
  DailySnapshotHolding,
  PortfolioDailyAssistantView,
  PortfolioPerformanceResponse,
} from "./portfolio-daily-assistant-types";
import type { PortfolioDashboard } from "./portfolio-types";

const rebuildWindows = new Map<string, number[]>();

function jsonArray(value: Prisma.JsonValue): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function jsonAlerts(value: Prisma.JsonValue) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const row = item as Record<string, Prisma.JsonValue>;
    if (typeof row.type !== "string" || typeof row.message !== "string") return [];
    return [{
      type: row.type,
      severity: row.severity === "critical" ? "critical" as const : "warning" as const,
      message: row.message,
      symbol: typeof row.symbol === "string" ? row.symbol : undefined,
    }];
  });
}

function holdingDto(row: {
  holdingId: string; market: string; symbol: string; name: string; quantity: Prisma.Decimal; averagePrice: Prisma.Decimal;
  currentPrice: Prisma.Decimal | null; dailyChangePercent: Prisma.Decimal | null; currency: string; exchangeRate: Prisma.Decimal | null; marketValue: Prisma.Decimal | null;
  costBasis: Prisma.Decimal | null; unrealizedProfitLoss: Prisma.Decimal | null; returnPercent: Prisma.Decimal | null;
  weightPercent: Prisma.Decimal | null; priceObservedAt: Date | null; freshnessStatus: string;
}): DailySnapshotHolding {
  return {
    holdingId: row.holdingId,
    market: row.market,
    symbol: row.symbol,
    name: row.name,
    quantity: row.quantity.toString(),
    averagePrice: row.averagePrice.toString(),
    currentPrice: row.currentPrice?.toString() ?? null,
    dailyChangePercent: row.dailyChangePercent?.toString() ?? null,
    currency: row.currency,
    exchangeRate: row.exchangeRate?.toString() ?? null,
    marketValue: row.marketValue?.toString() ?? null,
    costBasis: row.costBasis?.toString() ?? null,
    unrealizedProfitLoss: row.unrealizedProfitLoss?.toString() ?? null,
    returnPercent: row.returnPercent?.toString() ?? null,
    weightPercent: row.weightPercent?.toString() ?? null,
    priceObservedAt: row.priceObservedAt?.toISOString() ?? null,
    freshnessStatus: row.freshnessStatus,
  };
}

function dashboardHoldings(dashboard: PortfolioDashboard): DailySnapshotHolding[] {
  return dashboard.holdings.map((item) => ({
    holdingId: item.holding.id,
    market: item.holding.market,
    symbol: item.holding.symbol,
    name: item.holding.name,
    quantity: item.holding.quantity,
    averagePrice: item.holding.averagePrice,
    currentPrice: item.price.currentPrice,
    currency: item.holding.currency,
    dailyChangePercent: item.price.changePercent,
    exchangeRate: item.holding.currency === dashboard.summary.baseCurrency
      ? "1"
      : dashboard.summary.exchangeRateFreshness === "fresh" ? dashboard.summary.exchangeRate : null,
    marketValue: item.baseMarketValue,
    costBasis: item.baseCostBasis,
    unrealizedProfitLoss: item.baseProfitLoss,
    returnPercent: item.returnPercent,
    weightPercent: item.weightPercent,
    priceObservedAt: item.price.observedAt,
    freshnessStatus: item.price.freshnessStatus,
  }));
}

function inactiveAttributionRows(current: DailySnapshotHolding[], previous: DailySnapshotHolding[], exchangeRate: string | null) {
  const currentIds = new Set(current.map((item) => item.holdingId));
  return previous.filter((item) => !currentIds.has(item.holdingId)).map((item) => ({
    ...item,
    quantity: "0",
    marketValue: "0",
    exchangeRate: item.currency === "KRW" ? "1" : exchangeRate ?? item.exchangeRate,
  }));
}

function buildAlerts(
  holdings: DailySnapshotHolding[],
  changes: DailyHoldingChange[],
  status: string,
  alertPricePercent: number,
) {
  const alerts: Array<{ type: string; severity: "warning" | "critical"; message: string; symbol?: string }> = [];
  for (const change of changes) {
    if (change.changeType === "added") alerts.push({ type: "holding_added", severity: "warning", symbol: change.symbol, message: `${change.symbol} 신규 보유종목이 확인되었습니다.` });
    if (["quantity_increased", "quantity_decreased", "inactive"].includes(change.changeType)) {
      alerts.push({ type: "quantity_changed", severity: "warning", symbol: change.symbol, message: `${change.symbol} 보유수량 상태가 변경되었습니다.` });
    }
  }
  for (const holding of holdings) {
    if (holding.freshnessStatus !== "fresh") {
      alerts.push({ type: "stale_price", severity: "warning", symbol: holding.symbol, message: `${holding.symbol} 시세 최신성을 확인해야 합니다.` });
    }
    const dailyChange = holding.dailyChangePercent == null ? null : Math.abs(Number(holding.dailyChangePercent));
    if (dailyChange != null && Number.isFinite(dailyChange) && dailyChange >= alertPricePercent) {
      alerts.push({ type: "large_price_move", severity: "warning", symbol: holding.symbol, message: `${holding.symbol} 일간 가격 변동률이 ${alertPricePercent}% 이상입니다.` });
    }
  }
  if (status === "partial") alerts.push({ type: "partial_snapshot", severity: "warning", message: "일부 가격 또는 환율 데이터가 누락된 부분 스냅샷입니다." });
  return alerts;
}

async function writeAssistantEvents(input: {
  sourceSyncRunId: string;
  accountId: string;
  snapshotId: string;
  changeCount: number;
  briefingCreated: boolean;
}) {
  const rows = [
    { suffix: "snapshot", type: "PORTFOLIO_SNAPSHOT_CREATED", summary: "일일 포트폴리오 Snapshot 저장 완료" },
    ...(input.changeCount ? [{ suffix: "changes", type: "PORTFOLIO_CHANGE_DETECTED", summary: `포트폴리오 변경 ${input.changeCount}종목 감지` }] : []),
    ...(input.briefingCreated ? [{ suffix: "briefing", type: "PORTFOLIO_BRIEFING_CREATED", summary: "규칙 기반 일일 포트폴리오 브리핑 생성 완료" }] : []),
  ];
  for (const row of rows) {
    await prisma.eventLog.upsert({
      where: { id: `event-${row.suffix}-${input.sourceSyncRunId}` },
      create: {
        id: `event-${row.suffix}-${input.sourceSyncRunId}`,
        type: row.type,
        summary: row.summary,
        payload: { sourceSyncRunId: input.sourceSyncRunId, accountId: input.accountId, snapshotId: input.snapshotId, readOnly: true },
      },
      update: { timestamp: new Date(), summary: row.summary },
    });
  }
}

export async function capturePortfolioDailySnapshot(input: {
  dashboard: PortfolioDashboard;
  sourceSyncRunId: string;
  marketDate: string;
}) {
  const config = getPortfolioDailyAssistantConfig();
  if (!config.snapshotEnabled) return { enabled: false as const, reason: "PORTFOLIO_DAILY_SNAPSHOT_ENABLED=false" };
  const existing = await prisma.portfolioDailySnapshot.findUnique({ where: { sourceSyncRunId: input.sourceSyncRunId } });
  if (existing) return { enabled: true as const, created: false, snapshotId: existing.id };
  const dashboard = input.dashboard;
  if (!dashboard.account) throw new Error("일일 Snapshot을 저장할 활성 계좌가 없습니다.");
  const currentHoldings = dashboardHoldings(dashboard);
  const marketDate = new Date(`${input.marketDate}T00:00:00.000Z`);
  const comparisonStart = new Date(marketDate.getTime() - 7 * 86_400_000);
  const previous = await prisma.portfolioDailySnapshot.findFirst({
    where: {
      portfolioAccountId: dashboard.account.id,
      marketDate: { lt: marketDate, gte: comparisonStart },
      status: "success",
      isPrimary: true,
    },
    orderBy: [{ marketDate: "desc" }, { capturedAt: "desc" }],
    include: { holdings: true },
  });
  const previousHoldings = previous?.holdings.map(holdingDto) ?? [];
  const comparisonCurrent = [
    ...currentHoldings,
    ...inactiveAttributionRows(currentHoldings, previousHoldings, dashboard.summary.exchangeRate),
  ];
  const changes = detectDailyHoldingChanges(currentHoldings, previousHoldings);
  const attributions = config.attributionEnabled && previous
    ? calculateDailyAttributions(comparisonCurrent, previousHoldings)
    : [];
  const freshnessStatus = currentHoldings.every((item) => item.freshnessStatus === "fresh") ? "fresh"
    : currentHoldings.some((item) => item.freshnessStatus === "unavailable") ? "unavailable" : "stale";
  const usdMissingFx = currentHoldings.some((item) => item.currency !== dashboard.summary.baseCurrency && item.exchangeRate == null);
  const missingItems = Array.from(new Set([
    ...dashboard.summary.missingItems,
    ...(usdMissingFx ? ["USD/KRW 환율"] : []),
  ]));
  const status = dashboard.summary.dataQuality === "verified" && freshnessStatus === "fresh" && !missingItems.length ? "success" : "partial";
  const briefing = buildRuleBasedDailyBriefing({
    syncSucceeded: true,
    comparisonCapturedAt: previous?.capturedAt.toISOString() ?? null,
    totalChange: previous ? new Prisma.Decimal(dashboard.summary.totalMarketValue).sub(previous.totalMarketValue).toString() : null,
    changes,
    attributions,
    freshnessStatus,
    missingItems,
  });
  const alerts = buildAlerts(currentHoldings, changes, status, config.alertPricePercent);

  let snapshot;
  try {
    snapshot = await prisma.$transaction(async (tx) => {
    await tx.portfolioDailySnapshot.updateMany({
      where: { portfolioAccountId: dashboard.account!.id, marketDate, isPrimary: true },
      data: { isPrimary: false },
    });
    const created = await tx.portfolioDailySnapshot.create({
      data: {
        portfolioAccountId: dashboard.account!.id,
        marketDate,
        timezone: config.timezone,
        sourceSyncRunId: input.sourceSyncRunId,
        baseCurrency: dashboard.summary.baseCurrency,
        totalMarketValue: dashboard.summary.totalMarketValue,
        totalCostBasis: dashboard.summary.totalCostBasis,
        totalUnrealizedProfitLoss: dashboard.summary.totalProfitLoss,
        totalReturnPercent: dashboard.summary.totalReturnPercent,
        exchangeRate: dashboard.summary.exchangeRate,
        exchangeRateObservedAt: dashboard.summary.exchangeRateAsOf ? new Date(dashboard.summary.exchangeRateAsOf) : null,
        holdingCount: currentHoldings.length,
        status,
        dataQuality: dashboard.summary.dataQuality,
        freshnessStatus,
        missingItems,
        holdings: {
          create: currentHoldings.map((item) => ({
            holdingId: item.holdingId,
            market: item.market,
            symbol: item.symbol,
            name: item.name,
            quantity: item.quantity,
            averagePrice: item.averagePrice,
            currentPrice: item.currentPrice,
            dailyChangePercent: item.dailyChangePercent,
            currency: item.currency,
            exchangeRate: item.exchangeRate,
            marketValue: item.marketValue,
            costBasis: item.costBasis,
            unrealizedProfitLoss: item.unrealizedProfitLoss,
            returnPercent: item.returnPercent,
            weightPercent: item.weightPercent,
            priceObservedAt: item.priceObservedAt ? new Date(item.priceObservedAt) : null,
            freshnessStatus: item.freshnessStatus,
          })),
        },
      },
    });
    if (changes.length) {
      await tx.portfolioDailyHoldingChange.createMany({
        data: changes.map((item) => ({
          portfolioAccountId: dashboard.account!.id,
          currentSnapshotId: created.id,
          previousSnapshotId: previous?.id ?? null,
          holdingId: item.holdingId,
          symbol: item.symbol,
          changeType: item.changeType,
          previousQuantity: item.previousQuantity,
          currentQuantity: item.currentQuantity,
          quantityChange: item.quantityChange,
          previousAveragePrice: item.previousAveragePrice,
          currentAveragePrice: item.currentAveragePrice,
          previousMarketValue: item.previousMarketValue,
          currentMarketValue: item.currentMarketValue,
        })),
      });
    }
    if (attributions.length && previous) {
      await tx.portfolioChangeAttribution.createMany({
        data: attributions.map((item) => ({
          currentSnapshotId: created.id,
          previousSnapshotId: previous.id,
          holdingId: item.holdingId,
          symbol: item.symbol,
          totalMarketValueChange: item.totalMarketValueChange,
          quantityEffect: item.quantityEffect,
          priceEffect: item.priceEffect,
          fxEffect: item.fxEffect,
          residualEffect: item.residualEffect,
          currency: item.currency,
          method: item.method,
        })),
      });
    }
    if (config.assistantEnabled) {
      await tx.portfolioDailyBriefing.create({
        data: {
          portfolioAccountId: dashboard.account!.id,
          snapshotId: created.id,
          previousSnapshotId: previous?.id ?? null,
          reportDate: marketDate,
          status: briefing.status,
          headline: briefing.headline,
          summary: briefing.summary,
          changes: changes.filter((item) => item.changeType !== "unchanged") as unknown as Prisma.InputJsonValue,
          alerts: alerts as unknown as Prisma.InputJsonValue,
          dataQuality: dashboard.summary.dataQuality,
        },
      });
    }
      return created;
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const duplicate = await prisma.portfolioDailySnapshot.findUnique({ where: { sourceSyncRunId: input.sourceSyncRunId } });
      if (duplicate) return { enabled: true as const, created: false, snapshotId: duplicate.id };
    }
    throw error;
  }
  await writeAssistantEvents({
    sourceSyncRunId: input.sourceSyncRunId,
    accountId: dashboard.account.id,
    snapshotId: snapshot.id,
    changeCount: changes.filter((item) => item.changeType !== "unchanged").length,
    briefingCreated: config.assistantEnabled,
  });
  const retentionCutoff = new Date(Date.now() - config.retentionDays * 86_400_000);
  await prisma.portfolioDailySnapshot.deleteMany({
    where: { portfolioAccountId: dashboard.account.id, marketDate: { lt: retentionCutoff } },
  });
  return { enabled: true as const, created: true, snapshotId: snapshot.id, status };
}

function changeDto(row: {
  holdingId: string; symbol: string; changeType: string; previousQuantity: Prisma.Decimal | null; currentQuantity: Prisma.Decimal | null;
  quantityChange: Prisma.Decimal | null; previousAveragePrice: Prisma.Decimal | null; currentAveragePrice: Prisma.Decimal | null;
  previousMarketValue: Prisma.Decimal | null; currentMarketValue: Prisma.Decimal | null; holding: { name: string };
}): DailyHoldingChange {
  return {
    holdingId: row.holdingId,
    symbol: row.symbol,
    name: row.holding.name,
    changeType: row.changeType as DailyHoldingChange["changeType"],
    previousQuantity: row.previousQuantity?.toString() ?? null,
    currentQuantity: row.currentQuantity?.toString() ?? null,
    quantityChange: row.quantityChange?.toString() ?? null,
    previousAveragePrice: row.previousAveragePrice?.toString() ?? null,
    currentAveragePrice: row.currentAveragePrice?.toString() ?? null,
    previousMarketValue: row.previousMarketValue?.toString() ?? null,
    currentMarketValue: row.currentMarketValue?.toString() ?? null,
  };
}

function attributionDto(row: {
  holdingId: string; symbol: string; currency: string; totalMarketValueChange: Prisma.Decimal; quantityEffect: Prisma.Decimal;
  priceEffect: Prisma.Decimal; fxEffect: Prisma.Decimal; residualEffect: Prisma.Decimal; method: string; holding: { name: string };
}): DailyAttribution {
  return {
    holdingId: row.holdingId,
    symbol: row.symbol,
    name: row.holding.name,
    currency: row.currency,
    totalMarketValueChange: row.totalMarketValueChange.toString(),
    quantityEffect: row.quantityEffect.toString(),
    priceEffect: row.priceEffect.toString(),
    fxEffect: row.fxEffect.toString(),
    residualEffect: row.residualEffect.toString(),
    quantityChanged: !row.quantityEffect.isZero(),
    method: row.method as DailyAttribution["method"],
  };
}

export async function getPortfolioDailyAssistant(accountId?: string | null): Promise<PortfolioDailyAssistantView | { enabled: false; message: string }> {
  const config = getPortfolioDailyAssistantConfig();
  if (!config.assistantEnabled) return { enabled: false, message: "일일 포트폴리오 비서는 사용자 승인 전까지 비활성화되어 있습니다." };
  const account = accountId
    ? await prisma.portfolioAccount.findFirst({ where: { id: accountId, isActive: true } })
    : await prisma.portfolioAccount.findFirst({ where: { isActive: true }, orderBy: { createdAt: "asc" } });
  const snapshot = account ? await prisma.portfolioDailySnapshot.findFirst({
    where: { portfolioAccountId: account.id, isPrimary: true, status: { in: ["success", "partial"] } },
    orderBy: [{ marketDate: "desc" }, { capturedAt: "desc" }],
    include: {
      currentChanges: { include: { holding: { select: { name: true } } } },
      currentEffects: { include: { holding: { select: { name: true } } } },
      briefing: true,
    },
  }) : null;
  if (!snapshot) {
    return {
      enabled: true,
      generatedAt: new Date().toISOString(),
      status: "collecting",
      headline: "일일 포트폴리오 데이터 축적을 기다리고 있습니다.",
      summary: "비교할 이전 데이터가 아직 없습니다. 일일 데이터가 쌓이면 변화 내용을 확인할 수 있습니다.",
      snapshot: null,
      changes: [],
      attribution: null,
      topContributors: { positive: [], negative: [] },
      alerts: [],
    };
  }
  const previous = await prisma.portfolioDailySnapshot.findFirst({
    where: {
      portfolioAccountId: snapshot.portfolioAccountId,
      marketDate: { lt: snapshot.marketDate, gte: new Date(snapshot.marketDate.getTime() - 7 * 86_400_000) },
      status: "success",
      isPrimary: true,
    },
    orderBy: [{ marketDate: "desc" }, { capturedAt: "desc" }],
  });
  const changes = snapshot.currentChanges.map(changeDto).filter((item) => item.changeType !== "unchanged");
  const attributions = snapshot.currentEffects.map(attributionDto);
  const totals = sumAttributions(attributions);
  const positive = attributions.filter((item) => new Prisma.Decimal(item.totalMarketValueChange).greaterThan(0))
    .sort((a, b) => new Prisma.Decimal(b.totalMarketValueChange).comparedTo(a.totalMarketValueChange)).slice(0, 3);
  const negative = attributions.filter((item) => new Prisma.Decimal(item.totalMarketValueChange).lessThan(0))
    .sort((a, b) => new Prisma.Decimal(a.totalMarketValueChange).comparedTo(b.totalMarketValueChange)).slice(0, 3);
  const comparisonLabel = previous
    ? `${previous.capturedAt.toISOString()} 기준`
    : "비교할 이전 데이터가 아직 없습니다.";
  return {
    enabled: true,
    generatedAt: new Date().toISOString(),
    status: (snapshot.briefing?.status ?? (snapshot.status === "partial" ? "partial" : previous ? "ready" : "collecting")) as PortfolioDailyAssistantView["status"],
    headline: snapshot.briefing?.headline ?? (previous ? "오늘의 포트폴리오 변화가 계산되었습니다." : "일일 포트폴리오 데이터가 쌓이기 시작했습니다."),
    summary: snapshot.briefing?.summary ?? "비교할 이전 데이터가 아직 없습니다. 일일 데이터가 쌓이면 변화 내용을 확인할 수 있습니다.",
    snapshot: {
      id: snapshot.id,
      marketDate: snapshot.marketDate.toISOString().slice(0, 10),
      capturedAt: snapshot.capturedAt.toISOString(),
      comparisonCapturedAt: previous?.capturedAt.toISOString() ?? null,
      comparisonLabel,
      baseCurrency: snapshot.baseCurrency,
      totalMarketValue: snapshot.totalMarketValue.toString(),
      totalCostBasis: snapshot.totalCostBasis.toString(),
      totalUnrealizedProfitLoss: snapshot.totalUnrealizedProfitLoss.toString(),
      totalReturnPercent: snapshot.totalReturnPercent.toString(),
      totalChange: previous ? snapshot.totalMarketValue.sub(previous.totalMarketValue).toString() : null,
      holdingCount: snapshot.holdingCount,
      dataQuality: snapshot.dataQuality,
      freshnessStatus: snapshot.freshnessStatus,
      missingItems: jsonArray(snapshot.missingItems),
    },
    changes,
    attribution: previous && config.attributionEnabled ? {
      quantityEffect: totals.quantityEffect.toString(),
      priceEffect: totals.priceEffect.toString(),
      fxEffect: totals.fxEffect.toString(),
      residualEffect: totals.residualEffect.toString(),
      totalChange: totals.totalChange.toString(),
      items: attributions,
    } : null,
    topContributors: { positive, negative },
    alerts: snapshot.briefing ? jsonAlerts(snapshot.briefing.alerts) : [],
  };
}

export async function listPortfolioDailySnapshots(accountId?: string | null, take = 90) {
  return prisma.portfolioDailySnapshot.findMany({
    where: accountId ? { portfolioAccountId: accountId } : undefined,
    orderBy: [{ marketDate: "desc" }, { capturedAt: "desc" }],
    take: Math.max(1, Math.min(take, 730)),
    select: {
      id: true, portfolioAccountId: true, marketDate: true, capturedAt: true, baseCurrency: true,
      totalMarketValue: true, totalCostBasis: true, totalUnrealizedProfitLoss: true, totalReturnPercent: true,
      holdingCount: true, status: true, dataQuality: true, freshnessStatus: true, isPrimary: true,
    },
  });
}

export async function getPortfolioPerformance(
  range: PortfolioPerformanceResponse["range"],
  accountId?: string | null,
): Promise<PortfolioPerformanceResponse> {
  const config = getPortfolioDailyAssistantConfig();
  if (!config.assistantEnabled) return { enabled: false, range, sufficient: false, message: "일일 포트폴리오 비서가 비활성화되어 있습니다.", points: [] };
  const now = new Date();
  const start = range === "7d" ? new Date(now.getTime() - 7 * 86_400_000)
    : range === "30d" ? new Date(now.getTime() - 30 * 86_400_000)
    : range === "3m" ? new Date(now.getTime() - 92 * 86_400_000)
    : range === "ytd" ? new Date(Date.UTC(now.getUTCFullYear(), 0, 1))
    : null;
  const rows = await prisma.portfolioDailySnapshot.findMany({
    where: {
      ...(accountId ? { portfolioAccountId: accountId } : {}),
      ...(start ? { marketDate: { gte: start } } : {}),
      isPrimary: true,
      status: { in: ["success", "partial"] },
    },
    orderBy: [{ marketDate: "asc" }, { capturedAt: "asc" }],
    include: { currentChanges: { select: { changeType: true } } },
  });
  const points = rows.map((row) => ({
    snapshotId: row.id,
    marketDate: row.marketDate.toISOString().slice(0, 10),
    capturedAt: row.capturedAt.toISOString(),
    totalMarketValue: row.totalMarketValue.toString(),
    totalCostBasis: row.totalCostBasis.toString(),
    totalUnrealizedProfitLoss: row.totalUnrealizedProfitLoss.toString(),
    holdingCount: row.holdingCount,
    quantityChangeCount: row.currentChanges.filter((item) => ["added", "quantity_increased", "quantity_decreased", "inactive"].includes(item.changeType)).length,
    status: row.status,
  }));
  return {
    enabled: true,
    range,
    sufficient: points.length >= 2,
    message: points.length >= 2
      ? "보유수량 변경과 신규 매수 효과가 포함된 평가 스냅샷 추이입니다."
      : "선택 기간의 데이터가 충분하지 않습니다. 데이터 축적 중입니다.",
    points,
  };
}

export function assertDailyAssistantRebuildRateLimit(key: string, now = Date.now()) {
  const attempts = (rebuildWindows.get(key) ?? []).filter((time) => time >= now - 60_000);
  if (attempts.length >= 2) throw new Error("DAILY_ASSISTANT_REBUILD_RATE_LIMITED");
  attempts.push(now);
  rebuildWindows.set(key, attempts);
}
