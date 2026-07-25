import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  buildDailySnapshotDraft,
  buildRuleBasedDailyBriefing,
  calculateDailyAttributions,
  calculateHoldingAttribution,
  dailySnapshotIdempotencyKey,
  detectDailyHoldingChanges,
  selectLatestPrimarySnapshot,
  selectPreviousSnapshot,
  sumAttributions,
} from "./portfolio-daily-assistant-calculations.ts";
import { getPortfolioDailyAssistantConfig } from "./portfolio-daily-assistant-config.ts";
import type { DailySnapshotHolding } from "./portfolio-daily-assistant-types.ts";

function holding(overrides: Partial<DailySnapshotHolding> = {}): DailySnapshotHolding {
  return {
    holdingId: "synthetic-holding-a",
    market: "US",
    symbol: "SYNTH",
    name: "합성 테스트 종목",
    quantity: "10",
    averagePrice: "80",
    currentPrice: "100",
    currency: "USD",
    exchangeRate: "1300",
    marketValue: "1300000",
    costBasis: "1040000",
    unrealizedProfitLoss: "260000",
    returnPercent: "25",
    weightPercent: "100",
    priceObservedAt: "2026-07-25T00:00:00.000Z",
    freshnessStatus: "fresh",
    ...overrides,
  };
}

test("1. Daily Snapshot draft를 합성 데이터로 생성한다", () => {
  const result = buildDailySnapshotDraft({ sourceSyncRunId: "run-1", marketDate: "2026-07-25", holdings: [holding()], missingItems: [], dataQuality: "verified" });
  assert.equal(result.status, "success");
  assert.equal(result.holdingCount, 1);
});

test("2. 동일 Sync Run은 동일 멱등성 키를 사용한다", () => {
  assert.equal(dailySnapshotIdempotencyKey("run-a"), dailySnapshotIdempotencyKey("run-a"));
  assert.notEqual(dailySnapshotIdempotencyKey("run-a"), dailySnapshotIdempotencyKey("run-b"));
});

test("3. 하루 여러 Snapshot 중 최신 정상 건을 선택한다", () => {
  const selected = selectLatestPrimarySnapshot([
    { marketDate: "2026-07-25", capturedAt: "2026-07-25T00:00:00Z", status: "success" },
    { marketDate: "2026-07-25", capturedAt: "2026-07-25T01:00:00Z", status: "partial" },
  ]);
  assert.equal(selected?.capturedAt, "2026-07-25T01:00:00Z");
});

test("4. 전일 마지막 정상 Snapshot을 비교 기준으로 선택한다", () => {
  const selected = selectPreviousSnapshot([
    { marketDate: "2026-07-23", capturedAt: "2026-07-23T01:00:00Z", status: "success" },
    { marketDate: "2026-07-24", capturedAt: "2026-07-24T01:00:00Z", status: "success" },
  ], "2026-07-25");
  assert.equal(selected?.marketDate, "2026-07-24");
});

test("5. 최근 7일 내 이전 Snapshot이 없으면 null이다", () => {
  assert.equal(selectPreviousSnapshot([{ marketDate: "2026-07-01", capturedAt: "2026-07-01T00:00:00Z", status: "success" }], "2026-07-25"), null);
});

test("6. 수량 증가를 감지한다", () => {
  assert.equal(detectDailyHoldingChanges([holding({ quantity: "11" })], [holding()])[0].changeType, "quantity_increased");
});

test("7. 수량 감소를 감지한다", () => {
  assert.equal(detectDailyHoldingChanges([holding({ quantity: "9" })], [holding()])[0].changeType, "quantity_decreased");
});

test("8. 신규 종목을 감지한다", () => {
  assert.equal(detectDailyHoldingChanges([holding()], [])[0].changeType, "added");
});

test("9. 사라진 활성 종목을 비활성으로 감지한다", () => {
  assert.equal(detectDailyHoldingChanges([], [holding()])[0].changeType, "inactive");
});

test("10. 동일 수량의 평균단가 변경을 감지한다", () => {
  assert.equal(detectDailyHoldingChanges([holding({ averagePrice: "81" })], [holding()])[0].changeType, "average_price_changed");
});

test("11. 수량 영향을 순차 분해한다", () => {
  const result = calculateHoldingAttribution(holding({ quantity: "12", marketValue: "1560000" }), holding())!;
  assert.equal(result.quantityEffect, "260000");
});

test("12. 주가 영향을 순차 분해한다", () => {
  const result = calculateHoldingAttribution(holding({ currentPrice: "110", marketValue: "1430000" }), holding())!;
  assert.equal(result.priceEffect, "130000");
});

test("13. 환율 영향을 순차 분해한다", () => {
  const result = calculateHoldingAttribution(holding({ exchangeRate: "1350", marketValue: "1350000" }), holding())!;
  assert.equal(result.fxEffect, "50000");
});

test("14. 수량·주가·환율·residual 합은 전체 변화와 일치한다", () => {
  const result = calculateHoldingAttribution(
    holding({ quantity: "12", currentPrice: "110", exchangeRate: "1350", marketValue: "1782000" }),
    holding(),
  )!;
  const totals = sumAttributions([result]);
  assert.equal(totals.quantityEffect.add(totals.priceEffect).add(totals.fxEffect).add(totals.residualEffect).toString(), totals.totalChange.toString());
});

test("15. KRW 자산은 환율 1로 처리한다", () => {
  const before = holding({ market: "KR", currency: "KRW", exchangeRate: null, quantity: "10", currentPrice: "1000", marketValue: "10000" });
  const current = holding({ market: "KR", currency: "KRW", exchangeRate: null, quantity: "10", currentPrice: "1100", marketValue: "11000" });
  const result = calculateHoldingAttribution(current, before)!;
  assert.equal(result.fxEffect, "0");
  assert.equal(result.priceEffect, "1000");
});

test("16. Decimal 계산은 0.1 + 0.2 부동소수점 오차를 만들지 않는다", () => {
  const before = holding({ quantity: "0.1", currentPrice: "1", exchangeRate: "1", marketValue: "0.1" });
  const current = holding({ quantity: "0.3", currentPrice: "1", exchangeRate: "1", marketValue: "0.3" });
  assert.equal(calculateHoldingAttribution(current, before)?.quantityEffect, "0.2");
});

test("17. stale 시세는 정상 Snapshot으로 표시하지 않는다", () => {
  const result = buildDailySnapshotDraft({ sourceSyncRunId: "run", marketDate: "2026-07-25", holdings: [holding({ freshnessStatus: "stale" })], missingItems: [], dataQuality: "verified" });
  assert.equal(result.status, "partial");
  assert.equal(result.freshnessStatus, "stale");
});

test("18. USD 환율 missing이면 기여도 계산을 차단한다", () => {
  assert.equal(calculateHoldingAttribution(holding({ exchangeRate: null }), holding()), null);
});

test("19. 누락 데이터는 partial Snapshot이 된다", () => {
  const result = buildDailySnapshotDraft({ sourceSyncRunId: "run", marketDate: "2026-07-25", holdings: [holding({ exchangeRate: null })], missingItems: [], dataQuality: "provisional" });
  assert.equal(result.status, "partial");
  assert.deepEqual(result.missingItems, ["USD/KRW 환율"]);
});

test("20. 규칙 기반 브리핑에 비교·변화·최신성이 포함된다", () => {
  const attributions = calculateDailyAttributions([holding({ currentPrice: "110", marketValue: "1430000" })], [holding()]);
  const result = buildRuleBasedDailyBriefing({
    syncSucceeded: true,
    comparisonCapturedAt: "2026-07-24T23:30:00Z",
    totalChange: "130000",
    changes: detectDailyHoldingChanges([holding({ currentPrice: "110", marketValue: "1430000" })], [holding()]),
    attributions,
    freshnessStatus: "fresh",
    missingItems: [],
  });
  assert.match(result.summary, /비교 기준/);
  assert.match(result.summary, /데이터 최신성 경고는 없습니다/);
});

test("21. 브리핑에는 직접적인 매수·매도 권고 문구가 없다", () => {
  const result = buildRuleBasedDailyBriefing({ syncSucceeded: true, comparisonCapturedAt: null, totalChange: null, changes: [], attributions: [], freshnessStatus: "fresh", missingItems: [] });
  for (const phrase of ["매수하세요", "매도하세요", "비중을 줄이세요", "지금 정리하세요"]) assert.equal(result.summary.includes(phrase), false);
});

test("22. 모든 신규 API가 기존 관리자 인증 정책을 호출한다", () => {
  const routes = [
    "daily-assistant/route.ts",
    "daily-assistant/rebuild/route.ts",
    "daily-snapshots/route.ts",
    "performance/route.ts",
    "changes/route.ts",
    "change-attribution/route.ts",
  ];
  for (const route of routes) {
    const source = readFileSync(resolve(process.cwd(), "src/app/api/portfolio", route), "utf8");
    assert.match(source, /authorizePortfolioApi\(request/);
  }
});

test("23. 모든 신규 기능 플래그는 기본 OFF이다", () => {
  const config = getPortfolioDailyAssistantConfig({});
  assert.equal(config.assistantEnabled, false);
  assert.equal(config.snapshotEnabled, false);
  assert.equal(config.attributionEnabled, false);
});

test("24. Snapshot fixture와 멱등성 키에 계좌번호 필드가 없다", () => {
  const fixture = holding();
  assert.equal("accountNo" in fixture, false);
  assert.equal(dailySnapshotIdempotencyKey("synthetic-run").includes("account"), false);
});

test("25. 포트폴리오 API에 주문 endpoint가 존재하지 않는다", () => {
  const apiRoot = resolve(process.cwd(), "src/app/api/portfolio");
  for (const name of ["orders", "order", "buy", "sell", "transfer"]) assert.equal(existsSync(resolve(apiRoot, name)), false);
});
