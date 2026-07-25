import { Prisma } from "@prisma/client";
import type { DailyAttribution, DailyHoldingChange, DailySnapshotHolding } from "./portfolio-daily-assistant-types";

const ZERO = new Prisma.Decimal(0);
const ONE = new Prisma.Decimal(1);

function decimal(value: string | null | undefined, fallback = ZERO) {
  try {
    return value == null ? fallback : new Prisma.Decimal(value);
  } catch {
    return fallback;
  }
}

export function dailySnapshotIdempotencyKey(sourceSyncRunId: string) {
  return `portfolio-daily:${sourceSyncRunId}`;
}

export function buildDailySnapshotDraft(input: {
  sourceSyncRunId: string;
  marketDate: string;
  holdings: DailySnapshotHolding[];
  missingItems: string[];
  dataQuality: string;
}) {
  const freshnessStatus = input.holdings.every((item) => item.freshnessStatus === "fresh")
    ? "fresh"
    : input.holdings.some((item) => item.freshnessStatus === "unavailable") ? "unavailable" : "stale";
  const missingFx = input.holdings.some((item) => item.currency === "USD" && item.exchangeRate == null);
  const missingItems = Array.from(new Set([...input.missingItems, ...(missingFx ? ["USD/KRW 환율"] : [])]));
  return {
    idempotencyKey: dailySnapshotIdempotencyKey(input.sourceSyncRunId),
    marketDate: input.marketDate,
    holdingCount: input.holdings.length,
    freshnessStatus,
    missingItems,
    status: input.dataQuality === "verified" && freshnessStatus === "fresh" && !missingItems.length ? "success" as const : "partial" as const,
  };
}

export function selectLatestPrimarySnapshot<T extends { marketDate: string; capturedAt: string; status: string }>(items: T[]) {
  return [...items]
    .filter((item) => ["success", "partial"].includes(item.status))
    .sort((left, right) => Date.parse(right.capturedAt) - Date.parse(left.capturedAt))[0] ?? null;
}

export function selectPreviousSnapshot<T extends { marketDate: string; capturedAt: string; status: string }>(
  items: T[],
  currentMarketDate: string,
) {
  const cutoff = Date.parse(`${currentMarketDate}T00:00:00.000Z`);
  const earliest = cutoff - 7 * 86_400_000;
  return [...items]
    .filter((item) => item.status === "success")
    .filter((item) => {
      const value = Date.parse(`${item.marketDate}T00:00:00.000Z`);
      return value < cutoff && value >= earliest;
    })
    .sort((left, right) => Date.parse(right.capturedAt) - Date.parse(left.capturedAt))[0] ?? null;
}

export function detectDailyHoldingChanges(
  current: DailySnapshotHolding[],
  previous: DailySnapshotHolding[],
): DailyHoldingChange[] {
  const currentById = new Map(current.map((item) => [item.holdingId, item]));
  const previousById = new Map(previous.map((item) => [item.holdingId, item]));
  const holdingIds = new Set([...currentById.keys(), ...previousById.keys()]);
  return Array.from(holdingIds).map((holdingId) => {
    const now = currentById.get(holdingId);
    const before = previousById.get(holdingId);
    let changeType: DailyHoldingChange["changeType"] = "unchanged";
    if (!before && now) changeType = "added";
    else if (before && !now) changeType = "inactive";
    else if (before && now) {
      const quantityDelta = decimal(now.quantity).sub(before.quantity);
      if (quantityDelta.greaterThan(0)) changeType = "quantity_increased";
      else if (quantityDelta.lessThan(0)) changeType = "quantity_decreased";
      else if (!decimal(now.averagePrice).equals(before.averagePrice)) changeType = "average_price_changed";
    }
    return {
      holdingId,
      symbol: now?.symbol ?? before?.symbol ?? "",
      name: now?.name ?? before?.name ?? "",
      changeType,
      previousQuantity: before?.quantity ?? null,
      currentQuantity: now?.quantity ?? null,
      quantityChange: before || now ? decimal(now?.quantity).sub(decimal(before?.quantity)).toString() : null,
      previousAveragePrice: before?.averagePrice ?? null,
      currentAveragePrice: now?.averagePrice ?? null,
      previousMarketValue: before?.marketValue ?? null,
      currentMarketValue: now?.marketValue ?? null,
    };
  });
}

export function calculateHoldingAttribution(
  current: DailySnapshotHolding,
  previous: DailySnapshotHolding,
): DailyAttribution | null {
  if (current.currentPrice == null || previous.currentPrice == null) return null;
  const q0 = decimal(previous.quantity);
  const q1 = decimal(current.quantity);
  const p0 = decimal(previous.currentPrice);
  const p1 = decimal(current.currentPrice);
  const fx0 = previous.currency === "KRW" ? ONE : previous.exchangeRate == null ? null : decimal(previous.exchangeRate);
  const fx1 = current.currency === "KRW" ? ONE : current.exchangeRate == null ? null : decimal(current.exchangeRate);
  if (!fx0 || !fx1) return null;

  const previousValue = previous.marketValue == null ? q0.mul(p0).mul(fx0) : decimal(previous.marketValue);
  const currentValue = current.marketValue == null ? q1.mul(p1).mul(fx1) : decimal(current.marketValue);
  const quantityEffect = q1.sub(q0).mul(p0).mul(fx0);
  const priceEffect = q1.mul(p1.sub(p0)).mul(fx0);
  const fxEffect = q1.mul(p1).mul(fx1.sub(fx0));
  const totalMarketValueChange = currentValue.sub(previousValue);
  const residualEffect = totalMarketValueChange.sub(quantityEffect).sub(priceEffect).sub(fxEffect);
  return {
    holdingId: current.holdingId,
    symbol: current.symbol,
    name: current.name,
    currency: current.currency,
    totalMarketValueChange: totalMarketValueChange.toString(),
    quantityEffect: quantityEffect.toString(),
    priceEffect: priceEffect.toString(),
    fxEffect: fxEffect.toString(),
    residualEffect: residualEffect.toString(),
    quantityChanged: !q0.equals(q1),
    method: "sequential_quantity_price_fx",
  };
}

export function calculateDailyAttributions(
  current: DailySnapshotHolding[],
  previous: DailySnapshotHolding[],
) {
  const previousById = new Map(previous.map((item) => [item.holdingId, item]));
  return current.flatMap((item) => {
    const before = previousById.get(item.holdingId);
    if (!before) {
      if (item.currentPrice == null || item.marketValue == null) return [];
      const fx = item.currency === "KRW" ? ONE : item.exchangeRate == null ? null : decimal(item.exchangeRate);
      if (!fx) return [];
      const addedBaseline = { ...item, quantity: "0", averagePrice: item.averagePrice, exchangeRate: fx.toString(), marketValue: "0" };
      const attribution = calculateHoldingAttribution(item, addedBaseline);
      return attribution ? [attribution] : [];
    }
    const attribution = calculateHoldingAttribution(item, before);
    return attribution ? [attribution] : [];
  });
}

export function sumAttributions(items: DailyAttribution[]) {
  return items.reduce((sum, item) => ({
    quantityEffect: sum.quantityEffect.add(item.quantityEffect),
    priceEffect: sum.priceEffect.add(item.priceEffect),
    fxEffect: sum.fxEffect.add(item.fxEffect),
    residualEffect: sum.residualEffect.add(item.residualEffect),
    totalChange: sum.totalChange.add(item.totalMarketValueChange),
  }), {
    quantityEffect: ZERO,
    priceEffect: ZERO,
    fxEffect: ZERO,
    residualEffect: ZERO,
    totalChange: ZERO,
  });
}

export function buildRuleBasedDailyBriefing(input: {
  syncSucceeded: boolean;
  comparisonCapturedAt: string | null;
  totalChange: string | null;
  changes: DailyHoldingChange[];
  attributions: DailyAttribution[];
  freshnessStatus: string;
  missingItems: string[];
}) {
  if (!input.syncSucceeded) {
    return {
      status: "needs_data" as const,
      headline: "오늘 계좌 동기화 상태를 확인해야 합니다.",
      summary: "토스 계좌 동기화에 실패했습니다. 마지막 정상 데이터는 유지되며 수동 재동기화 버튼으로 다시 확인할 수 있습니다.",
    };
  }
  if (!input.comparisonCapturedAt) {
    return {
      status: input.missingItems.length ? "partial" as const : "collecting" as const,
      headline: "일일 포트폴리오 데이터가 쌓이기 시작했습니다.",
      summary: "오늘 토스 계좌 동기화와 평가 스냅샷 저장이 완료되었습니다. 비교할 이전 데이터가 아직 없습니다. 일일 데이터가 쌓이면 변화 내용을 확인할 수 있습니다.",
    };
  }
  const quantitySymbols = input.changes
    .filter((item) => ["added", "quantity_increased", "quantity_decreased", "inactive"].includes(item.changeType))
    .map((item) => item.symbol);
  const averagePriceSymbols = input.changes
    .filter((item) => item.changeType === "average_price_changed")
    .map((item) => item.symbol);
  const sorted = [...input.attributions].sort((a, b) => decimal(b.totalMarketValueChange).comparedTo(a.totalMarketValueChange));
  const topRise = sorted.find((item) => decimal(item.totalMarketValueChange).isPositive())?.symbol;
  const topFall = [...sorted].reverse().find((item) => decimal(item.totalMarketValueChange).isNegative())?.symbol;
  const effects = sumAttributions(input.attributions);
  const effectLabels = [
    { label: "보유수량", value: effects.quantityEffect.abs() },
    { label: "주가", value: effects.priceEffect.abs() },
    { label: "환율", value: effects.fxEffect.abs() },
  ].sort((a, b) => b.value.comparedTo(a.value)).filter((item) => !item.value.isZero());
  const direction = decimal(input.totalChange).greaterThan(0) ? "증가" : decimal(input.totalChange).lessThan(0) ? "감소" : "변화 없음";
  const quality = input.freshnessStatus === "fresh" && input.missingItems.length === 0
    ? "데이터 최신성 경고는 없습니다."
    : `데이터 일부 확인이 필요합니다${input.missingItems.length ? `: ${input.missingItems.join(", ")}` : "."}`;
  return {
    status: input.missingItems.length || input.freshnessStatus !== "fresh" ? "partial" as const : "ready" as const,
    headline: `전체 평가금액은 이전 스냅샷보다 ${direction}했습니다.`,
    summary: [
      "오늘 토스 계좌 동기화와 포트폴리오 평가가 완료되었습니다.",
      `비교 기준은 ${input.comparisonCapturedAt}입니다.`,
      quantitySymbols.length
        ? `보유수량 관련 변화 종목은 ${quantitySymbols.join(", ")}입니다.`
        : averagePriceSymbols.length
          ? `평균단가 변경 종목은 ${averagePriceSymbols.join(", ")}입니다.`
          : "오늘 확인된 보유수량 및 평균단가 변화는 없습니다.",
      effectLabels.length ? `${effectLabels.slice(0, 2).map((item) => item.label).join("와 ")} 변화가 전체 평가금액에 큰 영향을 줬습니다.` : "평가금액의 주요 변화 요인이 없습니다.",
      topRise ? `${topRise}가 가장 큰 상승 기여 종목입니다.` : "",
      topFall ? `${topFall}가 가장 큰 하락 기여 종목입니다.` : "",
      quality,
    ].filter(Boolean).join(" "),
  };
}
