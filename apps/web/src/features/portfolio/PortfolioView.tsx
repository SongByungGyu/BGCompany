"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  AllocationDto,
  HoldingValuationDto,
  PortfolioDashboard,
  PortfolioHoldingDto,
  PortfolioResponse,
} from "@/lib/portfolio/portfolio-types";
import type {
  PortfolioDailyAssistantDisabled,
  PortfolioDailyAssistantView,
  PortfolioPerformanceResponse,
} from "@/lib/portfolio/portfolio-daily-assistant-types";
import type { PaperTradingResponse } from "@/lib/portfolio/paper-trading-types";
import {
  createDividendEvent,
  createPortfolioAccount,
  fetchPortfolio,
  refreshPortfolio,
  savePortfolioHolding,
  syncTossPortfolioAccount,
  fetchPortfolioDailyAssistant,
  fetchPortfolioPerformance,
  fetchPaperTrading,
  updatePaperTrading,
} from "./api";

type SortKey = "marketValue" | "profitLoss" | "returnPercent" | "weightPercent" | "name";
type PortfolioTab = "summary" | "paper" | "holdings" | "performance" | "dividend" | "schedule" | "news" | "risk" | "settings";

const PORTFOLIO_TABS: Array<{ id: PortfolioTab; label: string }> = [
  { id: "summary", label: "요약" },
  { id: "paper", label: "모의투자" },
  { id: "holdings", label: "보유종목" },
  { id: "performance", label: "성과" },
  { id: "dividend", label: "배당" },
  { id: "schedule", label: "일정" },
  { id: "news", label: "뉴스" },
  { id: "risk", label: "위험" },
  { id: "settings", label: "설정" },
];

const EMPTY_HOLDING = {
  market: "KR",
  symbol: "",
  name: "",
  assetType: "stock",
  quantity: "",
  averagePrice: "",
  currency: "KRW",
  sector: "",
  note: "",
  dividendTrackingEnabled: false,
};

const EMPTY_DIVIDEND = {
  market: "KR",
  symbol: "",
  dividendType: "annual",
  amountPerShare: "",
  currency: "KRW",
  exDividendDate: "",
  paymentDate: "",
  status: "estimated",
  sourceName: "",
  sourceUrl: "",
  dataQuality: "manual",
};

function number(value: string | null | undefined) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatAmount(value: string | null | undefined, currency = "KRW", maximumFractionDigits?: number) {
  const parsed = number(value);
  if (parsed == null) return "확인 필요";
  return new Intl.NumberFormat("ko-KR", {
    style: "currency",
    currency,
    maximumFractionDigits: maximumFractionDigits ?? (currency === "KRW" ? 0 : 2),
  }).format(parsed);
}

function formatNumber(value: string | null | undefined, maximumFractionDigits = 4) {
  const parsed = number(value);
  return parsed == null ? "—" : new Intl.NumberFormat("ko-KR", { maximumFractionDigits }).format(parsed);
}

function formatPercent(value: string | null | undefined) {
  const parsed = number(value);
  return parsed == null ? "—" : `${parsed > 0 ? "+" : ""}${parsed.toFixed(2)}%`;
}

function formatDate(value: string | null | undefined, withTime = false) {
  if (!value) return "미확인";
  return new Intl.DateTimeFormat("ko-KR", withTime
    ? { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }
    : { year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value));
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : "요청을 처리하지 못했습니다.";
}

function escapeCsv(value: unknown) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function parseCsvLine(line: string) {
  const values: string[] = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') { value += '"'; index += 1; }
      else quoted = !quoted;
    } else if (char === "," && !quoted) {
      values.push(value);
      value = "";
    } else value += char;
  }
  values.push(value);
  return values;
}

function SummaryCard({ label, value, detail, tone = "" }: { label: string; value: string; detail?: string; tone?: string }) {
  return <article className={`portfolio-summary-card ${tone}`}><span>{label}</span><strong>{value}</strong>{detail ? <small>{detail}</small> : null}</article>;
}

function AllocationBars({ title, items }: { title: string; items: AllocationDto[] }) {
  return <section className="portfolio-allocation-card"><header><h3>{title}</h3><span>{items.length}개 구간</span></header>{items.length ? <div className="portfolio-bars">{items.map((item) => <div key={item.key}><div><strong>{item.label}</strong><span>{formatPercent(item.weightPercent)}</span></div><i><b style={{ width: `${Math.min(number(item.weightPercent) ?? 0, 100)}%` }} /></i></div>)}</div> : <p className="portfolio-empty-copy">확인 가능한 평가금액이 있을 때 표시합니다.</p>}</section>;
}

function DailyAssistantSummary({
  assistant,
  dashboard,
}: {
  assistant: PortfolioDailyAssistantView | PortfolioDailyAssistantDisabled | null;
  dashboard: PortfolioDashboard;
}) {
  if (!assistant || !assistant.enabled) {
    return <>
      <section className="portfolio-daily-assistant disabled"><span>PHASE 2-P.2 · SAFE DEFAULT</span><h2>오늘의 포트폴리오 비서</h2><p>{assistant?.message ?? "일일 포트폴리오 비서를 확인하고 있습니다."}</p><code>PORTFOLIO_DAILY_ASSISTANT_ENABLED=false</code></section>
      <div className="portfolio-summary-grid">
        <SummaryCard label="총 평가금액" value={formatAmount(dashboard.summary.totalMarketValue, dashboard.summary.baseCurrency)} detail={dashboard.summary.dataQuality === "verified" ? "확인 가능한 최신 데이터" : "잠정값 포함"} />
        <SummaryCard label="총 원가" value={formatAmount(dashboard.summary.totalCostBasis, dashboard.summary.baseCurrency)} />
        <SummaryCard label="평가손익" value={formatAmount(dashboard.summary.totalProfitLoss, dashboard.summary.baseCurrency)} tone={(number(dashboard.summary.totalProfitLoss) ?? 0) >= 0 ? "positive" : "negative"} />
        <SummaryCard label="전체 수익률" value={formatPercent(dashboard.summary.totalReturnPercent)} tone={(number(dashboard.summary.totalReturnPercent) ?? 0) >= 0 ? "positive" : "negative"} />
        <SummaryCard label="예상 연간 배당" value={formatAmount(dashboard.summary.expectedAnnualDividend, dashboard.summary.baseCurrency)} />
        <SummaryCard label="데이터 기준 시각" value={formatDate(dashboard.dataAsOf, true)} />
      </div>
    </>;
  }
  const snapshot = assistant.snapshot;
  return <>
    <section className={`portfolio-daily-assistant ${assistant.status}`}>
      <div><span>DAILY PORTFOLIO ASSISTANT · RULES</span><h2>{assistant.headline}</h2><p>{assistant.summary}</p><small>{snapshot?.comparisonLabel ?? "데이터 축적 중"} · 평가 스냅샷 기준 변화이며, 매수금 유입과 보유수량 변경 효과가 포함됩니다.</small></div>
      <b>{assistant.status}</b>
    </section>
    <div className="portfolio-summary-grid assistant-kpis">
      <SummaryCard label="전체 평가금액" value={formatAmount(snapshot?.totalMarketValue ?? dashboard.summary.totalMarketValue, dashboard.summary.baseCurrency)} />
      <SummaryCard label="이전 Snapshot 대비" value={formatAmount(snapshot?.totalChange, dashboard.summary.baseCurrency)} tone={(number(snapshot?.totalChange) ?? 0) >= 0 ? "positive" : "negative"} />
      <SummaryCard label="보유수량 변경" value={`${assistant.changes.filter((item) => ["added", "quantity_increased", "quantity_decreased", "inactive"].includes(item.changeType)).length}종목`} />
      <SummaryCard label="데이터 최신성" value={snapshot?.freshnessStatus ?? "축적 중"} detail={snapshot?.dataQuality ?? "비교 데이터 없음"} />
      <SummaryCard label="마지막 동기화" value={formatDate(dashboard.autoSync.lastAccountSyncedAt, true)} />
      <SummaryCard label="다음 자동 동기화" value={formatDate(dashboard.autoSync.nextRunAt, true)} />
    </div>
    <div className="portfolio-assistant-grid">
      <section className="portfolio-section compact"><header><div><span>CHANGES</span><h2>오늘 변경사항</h2></div></header><div className="portfolio-change-list">{assistant.changes.length ? assistant.changes.map((item) => <article key={item.holdingId}><b>{item.symbol}</b><span>{item.changeType}</span><p>{item.name} · 수량 변화 {formatNumber(item.quantityChange, 8)}</p></article>) : <p className="portfolio-empty-copy">오늘 확인된 보유수량 및 평균단가 변화는 없습니다.</p>}</div></section>
      <section className="portfolio-section compact"><header><div><span>ATTRIBUTION</span><h2>평가금액 변화 원인</h2></div></header>{assistant.attribution ? <div className="portfolio-effect-grid"><SummaryCard label="수량 영향" value={formatAmount(assistant.attribution.quantityEffect, dashboard.summary.baseCurrency)} /><SummaryCard label="주가 영향" value={formatAmount(assistant.attribution.priceEffect, dashboard.summary.baseCurrency)} /><SummaryCard label="환율 영향" value={formatAmount(assistant.attribution.fxEffect, dashboard.summary.baseCurrency)} /><SummaryCard label="전체 변화" value={formatAmount(assistant.attribution.totalChange, dashboard.summary.baseCurrency)} /></div> : <p className="portfolio-empty-copy">비교 가능한 정상 Snapshot이 쌓이면 변화 원인을 표시합니다.</p>}<small>변화 원인 분리는 수량 → 가격 → 환율 순서로 계산한 추정 기여도입니다.</small></section>
    </div>
    <div className="portfolio-assistant-grid">
      <section className="portfolio-section compact"><header><div><span>CONTRIBUTORS</span><h2>상승·하락 기여 종목</h2></div></header><div className="portfolio-contributors"><div><b>상승 기여 상위</b>{assistant.topContributors.positive.map((item) => <p key={item.holdingId}>{item.symbol} <span>{formatAmount(item.totalMarketValueChange, dashboard.summary.baseCurrency)}</span>{item.quantityChanged ? <small>수량 변화 포함</small> : null}</p>)}</div><div><b>하락 기여 상위</b>{assistant.topContributors.negative.map((item) => <p key={item.holdingId}>{item.symbol} <span>{formatAmount(item.totalMarketValueChange, dashboard.summary.baseCurrency)}</span>{item.quantityChanged ? <small>수량 변화 포함</small> : null}</p>)}</div></div></section>
      <section className="portfolio-section compact"><header><div><span>CHECKLIST</span><h2>오늘 확인할 항목</h2></div></header><div className="portfolio-alert-list">{assistant.alerts.length ? assistant.alerts.map((alert, index) => <article key={`${alert.type}-${alert.symbol ?? index}`} className={alert.severity}><b>{alert.symbol ?? alert.type}</b><p>{alert.message}</p></article>) : <p className="portfolio-empty-copy">중요한 변화나 데이터 경고가 없습니다.</p>}</div></section>
    </div>
  </>;
}

function PerformancePanel({
  performance,
  range,
  onRange,
  currency,
}: {
  performance: PortfolioPerformanceResponse | null;
  range: PortfolioPerformanceResponse["range"];
  onRange: (range: PortfolioPerformanceResponse["range"]) => void;
  currency: string;
}) {
  const values = performance?.points.map((point) => number(point.totalMarketValue) ?? 0) ?? [];
  const minimum = values.length ? Math.min(...values) : 0;
  const maximum = values.length ? Math.max(...values) : 0;
  const span = Math.max(maximum - minimum, 1);
  const polyline = values.map((value, index) => `${values.length === 1 ? 50 : index / (values.length - 1) * 100},${92 - (value - minimum) / span * 78}`).join(" ");
  return <section className="portfolio-performance">
    <header><div><span>PERFORMANCE SNAPSHOTS</span><h2>평가 스냅샷 추이</h2><p>보유수량 변경과 신규 매수 효과가 포함된 평가 스냅샷 추이입니다.</p></div><div>{(["7d", "30d", "3m", "ytd", "all"] as const).map((item) => <button key={item} className={range === item ? "active" : ""} onClick={() => onRange(item)}>{item === "3m" ? "3개월" : item === "ytd" ? "연초 이후" : item === "all" ? "전체" : item.replace("d", "일")}</button>)}</div></header>
    {!performance?.sufficient ? <div className="portfolio-performance-empty"><strong>데이터 축적 중</strong><p>{performance?.message ?? "일일 Snapshot을 불러오고 있습니다."}</p></div> : <>
      <div className="portfolio-line-chart"><svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label="전체 평가금액 추이"><polyline points={polyline} /></svg></div>
      <div className="portfolio-performance-table">{performance.points.map((point) => <article key={point.snapshotId}><span>{point.marketDate}</span><strong>{formatAmount(point.totalMarketValue, currency)}</strong><small>원가 {formatAmount(point.totalCostBasis, currency)} · 미실현 손익 {formatAmount(point.totalUnrealizedProfitLoss, currency)} · 수량 변화 {point.quantityChangeCount}종목</small></article>)}</div>
    </>}
    <p className="portfolio-performance-note">입출금과 정기매수 영향을 제거한 순수 투자수익률이 아닙니다.</p>
  </section>;
}

function PaperTradingPanel({
  response,
  working,
  onAction,
}: {
  response: PaperTradingResponse | null;
  working: boolean;
  onAction: (action: "initialize" | "pause" | "resume" | "kill") => void;
}) {
  if (!response) return <section className="paper-trading-loading"><i /><strong>내부 모의계좌를 확인하고 있습니다.</strong></section>;
  if (!response.enabled) return <section className="paper-trading-disabled"><span>PAPER ENGINE · BLOCKED</span><h2>모의투자 실행 차단</h2><p>{response.message}</p><code>외부 주문 권한 · {response.externalOrderAuthorization}</code></section>;
  if (!response.account) return <section className="paper-trading-start">
    <div><span>PHASE 2-T.1 · INTERNAL ONLY</span><h2>가상자금 1,000만원으로 시작</h2><p>백테스트와 같은 위험 한도를 사용하는 내부 가상 브로커입니다. 증권사 주문 API와 실계좌 자금은 사용하지 않습니다.</p></div>
    <dl><div><dt>종목당 한도</dt><dd>{response.rules.maxPositionPercent * 100}%</dd></div><div><dt>동시 보유</dt><dd>{response.rules.maxOpenPositions}종목</dd></div><div><dt>하루 신규</dt><dd>{response.rules.maxNewPositionsPerDay}종목</dd></div><div><dt>거래당 위험</dt><dd>{response.rules.riskPerTrade * 100}%</dd></div></dl>
    <button className="primary" disabled={working} onClick={() => onAction("initialize")}>{working ? "준비 중" : "모의계좌 시작"}</button>
  </section>;

  const account = response.account;
  const gain = (number(account.totalReturnPercent) ?? 0) >= 0;
  return <div className="paper-trading-dashboard">
    <section className={`paper-trading-status ${account.status.toLowerCase()}`}>
      <div><span>PAPER · INTERNAL VIRTUAL BROKER</span><h2>{account.name}</h2><p>외부 주문 권한 <b>{response.externalOrderAuthorization}</b> · 마지막 실행 {formatDate(account.lastRunAt, true)} · 기준일 {account.lastMarketDate ?? "대기 중"}</p></div>
      <div className="paper-trading-controls"><strong>{account.status}</strong>{account.status === "ACTIVE" ? <button disabled={working} onClick={() => onAction("pause")}>일시정지</button> : null}{account.status === "PAUSED" ? <button className="primary" disabled={working} onClick={() => onAction("resume")}>재개</button> : null}{account.status !== "KILLED" ? <button className="danger" disabled={working} onClick={() => onAction("kill")}>긴급 정지</button> : null}</div>
    </section>
    <div className="portfolio-summary-grid paper-trading-kpis">
      <SummaryCard label="총 자산" value={formatAmount(account.equityKrw, "KRW")} detail={`초기 ${formatAmount(account.initialCapitalKrw, "KRW")}`} />
      <SummaryCard label="현금" value={formatAmount(account.cashKrw, "KRW")} />
      <SummaryCard label="보유 평가금액" value={formatAmount(account.marketValueKrw, "KRW")} />
      <SummaryCard label="누적 수익률" value={formatPercent(account.totalReturnPercent)} tone={gain ? "positive" : "negative"} />
      <SummaryCard label="실현 손익" value={formatAmount(account.realizedPnlKrw, "KRW")} tone={(number(account.realizedPnlKrw) ?? 0) >= 0 ? "positive" : "negative"} />
      <SummaryCard label="미실현 손익" value={formatAmount(account.unrealizedPnlKrw, "KRW")} tone={(number(account.unrealizedPnlKrw) ?? 0) >= 0 ? "positive" : "negative"} />
    </div>
    <section className="paper-trading-rule-strip"><article><span>거래당 위험</span><strong>{response.rules.riskPerTrade * 100}%</strong></article><article><span>종목당 최대</span><strong>{response.rules.maxPositionPercent * 100}%</strong></article><article><span>동시 보유</span><strong>{response.counts.openPositions} / {response.rules.maxOpenPositions}</strong></article><article><span>오늘 신규</span><strong>{response.counts.newPositionsToday} / {response.rules.maxNewPositionsPerDay}</strong></article><article><span>거절 신호</span><strong>{response.counts.rejectedSignalsToday}</strong></article><article><span>USD/KRW</span><strong>{formatNumber(account.usdKrw, 2)}</strong></article></section>
    <div className="paper-trading-columns">
      <section className="portfolio-section compact"><header><div><span>VIRTUAL POSITIONS</span><h2>모의 보유종목</h2><p>실제 보유종목과 분리된 가상 체결 결과입니다.</p></div><b>{response.positions.length}종목</b></header>
        <div className="paper-position-list">{response.positions.length ? response.positions.map((position) => <article key={position.id}><div><b>{position.symbol}</b><strong>{position.name}</strong><small>{position.strategy}</small></div><dl><div><dt>수량</dt><dd>{position.quantity}주</dd></div><div><dt>진입/현재</dt><dd>${Number(position.entryPriceUsd).toFixed(2)} / ${Number(position.lastPriceUsd).toFixed(2)}</dd></div><div><dt>손절가</dt><dd>${Number(position.stopPriceUsd).toFixed(2)}</dd></div><div><dt>평가손익</dt><dd className={(number(position.unrealizedPnlKrw) ?? 0) >= 0 ? "gain" : "loss"}>{formatAmount(position.unrealizedPnlKrw, "KRW")} · {formatPercent(position.returnPercent)}</dd></div></dl></article>) : <p className="portfolio-empty-copy">아직 체결된 모의 포지션이 없습니다. 전일 종가 신호가 생기면 다음 거래일 시가 기준으로 모의 체결합니다.</p>}</div>
      </section>
      <section className="portfolio-section compact"><header><div><span>AUDIT JOURNAL</span><h2>주문·체결·위험 로그</h2><p>거절된 신호까지 모두 남겨 판단 과정을 추적합니다.</p></div><b>{response.activity.length}건</b></header>
        <div className="paper-activity-list">{response.activity.length ? response.activity.map((item) => <article key={`${item.type}-${item.id}`} className={item.type}><i /><div><span>{item.symbol ?? item.type} · {item.status}</span><strong>{item.title}</strong><p>{item.detail}</p><small>{formatDate(item.occurredAt, true)}</small></div></article>) : <p className="portfolio-empty-copy">아직 실행 로그가 없습니다.</p>}</div>
      </section>
    </div>
    <p className="paper-trading-disclaimer">모든 주문과 체결은 내부 시뮬레이션입니다. 실계좌 주문·정정·취소·이체 API는 연결되어 있지 않습니다.</p>
  </div>;
}

export function PortfolioView() {
  const [response, setResponse] = useState<PortfolioResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [showAccountForm, setShowAccountForm] = useState(false);
  const [showHoldingForm, setShowHoldingForm] = useState(false);
  const [showDividendForm, setShowDividendForm] = useState(false);
  const [accountForm, setAccountForm] = useState({ name: "", baseCurrency: "KRW", description: "" });
  const [holdingForm, setHoldingForm] = useState(EMPTY_HOLDING);
  const [dividendForm, setDividendForm] = useState(EMPTY_DIVIDEND);
  const [editingHoldingId, setEditingHoldingId] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("marketValue");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const [activeTab, setActiveTab] = useState<PortfolioTab>("summary");
  const [assistant, setAssistant] = useState<PortfolioDailyAssistantView | PortfolioDailyAssistantDisabled | null>(null);
  const [performance, setPerformance] = useState<PortfolioPerformanceResponse | null>(null);
  const [performanceRange, setPerformanceRange] = useState<PortfolioPerformanceResponse["range"]>("30d");
  const [paperTrading, setPaperTrading] = useState<PaperTradingResponse | null>(null);
  const importRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async (nextAccountId?: string | null) => {
    setLoading(true);
    setError(null);
    try {
      const [data, paper] = await Promise.all([fetchPortfolio(nextAccountId), fetchPaperTrading()]);
      setResponse(data);
      setPaperTrading(paper);
      if (data.enabled && data.account) {
        setAccountId(data.account.id);
        const [daily, trend] = await Promise.all([
          fetchPortfolioDailyAssistant(data.account.id),
          fetchPortfolioPerformance(performanceRange, data.account.id),
        ]);
        setAssistant(daily);
        setPerformance(trend);
      } else {
        setAssistant(null);
        setPerformance(null);
      }
    } catch (requestError) {
      setError(errorText(requestError));
    } finally {
      setLoading(false);
    }
  }, [performanceRange]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const changePerformanceRange = (range: PortfolioPerformanceResponse["range"]) => {
    setPerformanceRange(range);
  };

  const onPaperAction = async (action: "initialize" | "pause" | "resume" | "kill") => {
    if (action === "kill" && !window.confirm("모의투자 엔진을 KILLED 상태로 전환할까요? UI에서는 다시 활성화할 수 없습니다.")) return;
    setWorking(true);
    setError(null);
    try {
      const data = await updatePaperTrading(action);
      setPaperTrading(data);
      setNotice(action === "initialize" ? "가상자금 1,000만원 모의계좌를 만들었습니다." : `모의투자 상태를 변경했습니다: ${action}`);
    } catch (requestError) { setError(errorText(requestError)); }
    finally { setWorking(false); }
  };

  const dashboard = response?.enabled ? response : null;
  const sortedHoldings = useMemo(() => {
    if (!dashboard) return [];
    const values = [...dashboard.holdings];
    values.sort((left, right) => {
      let result = 0;
      if (sortKey === "name") result = left.holding.name.localeCompare(right.holding.name, "ko");
      else {
        const field: keyof HoldingValuationDto = sortKey === "marketValue" ? "baseMarketValue" : sortKey === "profitLoss" ? "baseProfitLoss" : sortKey;
        result = (number(left[field] as string | null) ?? Number.NEGATIVE_INFINITY) - (number(right[field] as string | null) ?? Number.NEGATIVE_INFINITY);
      }
      return sortDirection === "asc" ? result : -result;
    });
    return values;
  }, [dashboard, sortDirection, sortKey]);

  const selectSort = (key: SortKey) => {
    if (key === sortKey) setSortDirection((current) => current === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDirection(key === "name" ? "asc" : "desc"); }
  };

  const resetHoldingForm = () => {
    setHoldingForm(EMPTY_HOLDING);
    setEditingHoldingId(null);
    setShowHoldingForm(false);
  };

  const editHolding = (holding: PortfolioHoldingDto) => {
    setHoldingForm({
      market: holding.market,
      symbol: holding.symbol,
      name: holding.name,
      assetType: holding.assetType,
      quantity: holding.quantity,
      averagePrice: holding.averagePrice,
      currency: holding.currency,
      sector: holding.sector,
      note: holding.note ?? "",
      dividendTrackingEnabled: holding.dividendTrackingEnabled,
    });
    setEditingHoldingId(holding.id);
    setShowHoldingForm(true);
  };

  const submitAccount = async (event: React.FormEvent) => {
    event.preventDefault();
    setWorking(true); setError(null);
    try {
      await createPortfolioAccount(accountForm);
      setAccountForm({ name: "", baseCurrency: "KRW", description: "" });
      setShowAccountForm(false);
      setNotice("계좌 그룹을 만들었습니다.");
      await load();
    } catch (requestError) { setError(errorText(requestError)); }
    finally { setWorking(false); }
  };

  const submitHolding = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!dashboard?.account) return;
    setWorking(true); setError(null);
    try {
      const input = editingHoldingId
        ? {
            name: holdingForm.name,
            quantity: holdingForm.quantity,
            averagePrice: holdingForm.averagePrice,
            sector: holdingForm.sector,
            note: holdingForm.note,
            dividendTrackingEnabled: holdingForm.dividendTrackingEnabled,
          }
        : { ...holdingForm, portfolioAccountId: dashboard.account.id };
      await savePortfolioHolding(input, editingHoldingId ?? undefined);
      setNotice(editingHoldingId ? "보유 종목을 수정하고 변경 이력을 남겼습니다." : "보유 종목을 추가했습니다.");
      resetHoldingForm();
      await load(dashboard.account.id);
    } catch (requestError) { setError(errorText(requestError)); }
    finally { setWorking(false); }
  };

  const deactivateHolding = async (holding: PortfolioHoldingDto) => {
    if (!window.confirm(`${holding.name}을(를) 비활성화할까요? 데이터는 삭제하지 않습니다.`)) return;
    setWorking(true); setError(null);
    try {
      await savePortfolioHolding({ isActive: false }, holding.id);
      setNotice("보유 종목을 비활성화했습니다.");
      await load(dashboard?.account?.id);
    } catch (requestError) { setError(errorText(requestError)); }
    finally { setWorking(false); }
  };

  const moveHolding = async (holdingId: string, targetAccountId: string) => {
    if (!targetAccountId) return;
    setWorking(true); setError(null);
    try {
      await savePortfolioHolding({ portfolioAccountId: targetAccountId }, holdingId);
      setNotice("종목을 다른 계좌 그룹으로 이동했습니다.");
      await load(dashboard?.account?.id);
    } catch (requestError) { setError(errorText(requestError)); }
    finally { setWorking(false); }
  };

  const submitDividend = async (event: React.FormEvent) => {
    event.preventDefault();
    setWorking(true); setError(null);
    try {
      await createDividendEvent(dividendForm);
      setDividendForm(EMPTY_DIVIDEND);
      setShowDividendForm(false);
      setNotice("배당 정보를 수동 등록했습니다. 입력한 상태를 그대로 유지합니다.");
      await load(dashboard?.account?.id);
    } catch (requestError) { setError(errorText(requestError)); }
    finally { setWorking(false); }
  };

  const onRefresh = async () => {
    if (!dashboard?.account) return;
    setWorking(true); setError(null); setNotice(null);
    try {
      const data = await refreshPortfolio(dashboard.account.id);
      setResponse(data);
      setNotice("조회 전용 시세·위험 신호·규칙 보고서를 갱신했습니다.");
      await load(data.account?.id);
    } catch (requestError) { setError(errorText(requestError)); }
    finally { setWorking(false); }
  };

  const onAccountSync = async () => {
    if (!dashboard?.accountSync.configured) return;
    if (!window.confirm("토스증권 공식 Open API로 국내·해외 보유종목을 읽기 전용 동기화할까요? 주문이나 계좌 제어는 실행하지 않습니다.")) return;
    setWorking(true); setError(null); setNotice(null);
    try {
      const data = await syncTossPortfolioAccount();
      setResponse(data.dashboard);
      if (data.dashboard.account) {
        setAccountId(data.dashboard.account.id);
        await load(data.dashboard.account.id);
      }
      setNotice(`실계좌 동기화 완료 · 국내 ${data.result.domesticCount}개 · 해외 ${data.result.overseasCount}개 · 신규 ${data.result.created}개 · 갱신 ${data.result.updated}개`);
    } catch (requestError) { setError(errorText(requestError)); }
    finally { setWorking(false); }
  };

  const exportCsv = () => {
    if (!dashboard) return;
    const headers = ["market", "symbol", "name", "assetType", "quantity", "averagePrice", "currency", "sector", "note", "dividendTrackingEnabled", "isActive"];
    const rows = dashboard.holdings.map(({ holding }) => headers.map((key) => escapeCsv(holding[key as keyof PortfolioHoldingDto])).join(","));
    const blob = new Blob([`\ufeff${headers.join(",")}\n${rows.join("\n")}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `portfolio-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const importCsv = async (file: File) => {
    if (!dashboard?.account) return;
    setWorking(true); setError(null);
    try {
      const lines = (await file.text()).replace(/^\ufeff/, "").split(/\r?\n/).filter(Boolean);
      const headers = parseCsvLine(lines.shift() ?? "");
      const required = ["market", "symbol", "name", "assetType", "quantity", "averagePrice", "currency", "sector"];
      if (required.some((header) => !headers.includes(header))) throw new Error(`CSV 필수 열: ${required.join(", ")}`);
      let imported = 0;
      for (const line of lines) {
        const values = parseCsvLine(line);
        const row = Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
        await savePortfolioHolding({
          portfolioAccountId: dashboard.account.id,
          market: row.market,
          symbol: row.symbol,
          name: row.name,
          assetType: row.assetType,
          quantity: row.quantity,
          averagePrice: row.averagePrice,
          currency: row.currency,
          sector: row.sector,
          note: row.note ?? "",
          dividendTrackingEnabled: row.dividendTrackingEnabled === "true",
        });
        imported += 1;
      }
      setNotice(`${imported}개 종목을 가져왔습니다.`);
      await load(dashboard.account.id);
    } catch (requestError) { setError(errorText(requestError)); }
    finally { setWorking(false); if (importRef.current) importRef.current.value = ""; }
  };

  if (loading && !response) return <section className="portfolio-loading"><i /><strong>포트폴리오 모니터링 화면을 불러오는 중입니다.</strong></section>;
  if (response && !response.enabled) return <section className="portfolio-disabled"><span>PHASE 2-P.1</span><h1>주식 모니터링팀</h1><p>{response.message}</p><div><strong>안전 기본값</strong><code>PORTFOLIO_MONITORING_ENABLED=false</code><small>운영 DB와 자동발행에는 영향을 주지 않습니다.</small></div></section>;

  return <section className="portfolio-workspace">
    <header className="portfolio-hero">
      <div><span>PHASE 2-P.2 · READ ONLY</span><h1>일일 포트폴리오 비서</h1><p>토스증권 읽기 전용 동기화 결과로 오늘의 변화와 평가 Snapshot 추이를 설명합니다. 주문, 계좌 제어, 직접적인 매매 권고는 수행하지 않습니다.</p></div>
      <div className="portfolio-hero-actions">
        {dashboard?.accounts.length ? <select value={accountId ?? ""} onChange={(event) => { setAccountId(event.target.value); void load(event.target.value); }}>{dashboard.accounts.map((account) => <option key={account.id} value={account.id}>{account.name} · {account.baseCurrency}</option>)}</select> : null}
        <button onClick={() => setShowAccountForm((value) => !value)}>계좌 그룹</button>
        {dashboard?.accountSync.enabled ? <button className="primary" disabled={working || !dashboard.accountSync.configured} onClick={() => void onAccountSync()}>{working ? "처리 중" : "실계좌 동기화"}</button> : null}
        <button className="primary" disabled={working || !dashboard?.account} onClick={() => void onRefresh()}>{working ? "처리 중" : "수동 새로고침"}</button>
      </div>
    </header>
    {error ? <div className="portfolio-alert error"><strong>처리 실패</strong><span>{error}</span><button onClick={() => setError(null)}>닫기</button></div> : null}
    {notice ? <div className="portfolio-alert success"><strong>완료</strong><span>{notice}</span><button onClick={() => setNotice(null)}>닫기</button></div> : null}
    {dashboard?.accountSync.enabled ? <section className={`portfolio-account-sync ${dashboard.accountSync.configured ? "ready" : "missing"}`}><div><span>TOSS SECURITIES · OFFICIAL API · READ ONLY</span><strong>{dashboard.accountSync.configured ? `${dashboard.accountSync.maskedAccount} 연결 준비 완료` : "운영 서버에 Open API 발급값 설정 필요"}</strong><p>계좌목록과 보유종목 GET만 허용됩니다. 주문·정정·취소·이체 경로는 코드에서 차단합니다.</p></div><dl><div><dt>마지막 계좌 동기화</dt><dd>{formatDate(dashboard.autoSync.lastAccountSyncedAt, true)}</dd></div><div><dt>마지막 가격 갱신</dt><dd>{formatDate(dashboard.autoSync.lastPriceRefreshedAt, true)}</dd></div><div><dt>자동 상태</dt><dd>{dashboard.autoSync.enabled ? dashboard.autoSync.status : "승인 대기 · OFF"}</dd></div><div><dt>변경 종목</dt><dd>{dashboard.autoSync.changedCount}개 · 추가 {dashboard.autoSync.createdCount} / 수량변경 {dashboard.autoSync.updatedCount} / 비활성 {dashboard.autoSync.deactivatedCount}</dd></div><div><dt>다음 예정</dt><dd>{formatDate(dashboard.autoSync.nextRunAt, true)}</dd></div>{dashboard.autoSync.error ? <div className="portfolio-sync-error"><dt>오류 원인</dt><dd>{dashboard.autoSync.error}</dd></div> : null}{dashboard.autoSync.freshnessWarning ? <div className="portfolio-sync-warning"><dt>최신성 경고</dt><dd>{dashboard.autoSync.freshnessWarning}</dd></div> : null}</dl></section> : null}
    {showAccountForm ? <form className="portfolio-inline-form" onSubmit={submitAccount}><label>계좌 별칭<input required value={accountForm.name} onChange={(event) => setAccountForm({ ...accountForm, name: event.target.value })} placeholder="예: 장기 투자" /></label><label>기준 통화<select value={accountForm.baseCurrency} onChange={(event) => setAccountForm({ ...accountForm, baseCurrency: event.target.value })}><option>KRW</option><option>USD</option></select></label><label className="wide">설명<input value={accountForm.description} onChange={(event) => setAccountForm({ ...accountForm, description: event.target.value })} placeholder="선택 입력" /></label><button className="primary" disabled={working}>생성</button></form> : null}
    {!dashboard?.account ? <section className="portfolio-first-step"><b>01</b><div><h2>{dashboard?.accountSync.enabled ? "토스증권 실계좌를 동기화하세요" : "첫 계좌 그룹을 만드세요"}</h2><p>{dashboard?.accountSync.enabled ? "공식 API로 실제 보유종목을 읽어 전용 계좌 그룹과 종목을 자동 생성합니다. 거래 기능은 없습니다." : "실제 보유 종목이나 금액은 자동으로 생성하지 않습니다."}</p></div>{dashboard?.accountSync.enabled ? <button className="primary" disabled={working || !dashboard.accountSync.configured} onClick={() => void onAccountSync()}>실계좌 동기화</button> : <button onClick={() => setShowAccountForm(true)}>계좌 그룹 만들기</button>}</section> : <>
      <nav className="portfolio-tabs" aria-label="포트폴리오 화면">{PORTFOLIO_TABS.map((tab) => <button key={tab.id} className={activeTab === tab.id ? "active" : ""} onClick={() => setActiveTab(tab.id)}>{tab.label}</button>)}</nav>
      {activeTab === "summary" ? <DailyAssistantSummary assistant={assistant} dashboard={dashboard} /> : null}
      {activeTab === "paper" ? <PaperTradingPanel response={paperTrading} working={working} onAction={(action) => void onPaperAction(action)} /> : null}
      {activeTab === "performance" ? <PerformancePanel performance={performance} range={performanceRange} onRange={changePerformanceRange} currency={dashboard.summary.baseCurrency} /> : null}
      <div className={`portfolio-legacy-detail tab-${activeTab}`} hidden={activeTab === "summary" || activeTab === "paper" || activeTab === "performance"}>
      <div className="portfolio-summary-grid" hidden={activeTab !== "holdings"}>
        <SummaryCard label="총 평가금액" value={formatAmount(dashboard.summary.totalMarketValue, dashboard.summary.baseCurrency)} detail={dashboard.summary.dataQuality === "verified" ? "확인 가능한 최신 데이터" : "잠정값 포함"} />
        <SummaryCard label="총 원가" value={formatAmount(dashboard.summary.totalCostBasis, dashboard.summary.baseCurrency)} />
        <SummaryCard label="평가손익" value={formatAmount(dashboard.summary.totalProfitLoss, dashboard.summary.baseCurrency)} tone={(number(dashboard.summary.totalProfitLoss) ?? 0) >= 0 ? "positive" : "negative"} />
        <SummaryCard label="전체 수익률" value={formatPercent(dashboard.summary.totalReturnPercent)} tone={(number(dashboard.summary.totalReturnPercent) ?? 0) >= 0 ? "positive" : "negative"} />
        <SummaryCard label="예상 연간 배당" value={formatAmount(dashboard.summary.expectedAnnualDividend, dashboard.summary.baseCurrency)} detail="확정·발표·추정 상태 구분" />
        <SummaryCard label="오늘 변동금액" value={formatAmount(dashboard.summary.todayChangeAmount, dashboard.summary.baseCurrency)} />
        <SummaryCard label="데이터 기준 시각" value={formatDate(dashboard.dataAsOf, true)} detail={dashboard.summary.exchangeRate ? `USD/KRW ${formatNumber(dashboard.summary.exchangeRate, 4)} · ${formatDate(dashboard.summary.exchangeRateAsOf, true)}` : "환율 사용 없음 또는 미확인"} />
      </div>

      <section className="portfolio-section" hidden={activeTab !== "holdings"}>
        <header><div><span>HOLDINGS</span><h2>보유 종목</h2><p>현재가가 stale 또는 unavailable이면 평가금액은 잠정값으로 표시합니다.</p></div><div className="portfolio-section-actions"><input ref={importRef} hidden type="file" accept=".csv,text/csv" onChange={(event) => { const file = event.target.files?.[0]; if (file) void importCsv(file); }} /><button onClick={() => importRef.current?.click()}>미래에셋/일반 CSV</button><button onClick={exportCsv}>CSV 내보내기</button><button className="primary" onClick={() => { resetHoldingForm(); setShowHoldingForm(true); }}>종목 추가</button></div></header>
        {showHoldingForm ? <form className="portfolio-holding-form" onSubmit={submitHolding}>
          <label>시장<select disabled={Boolean(editingHoldingId)} value={holdingForm.market} onChange={(event) => setHoldingForm({ ...holdingForm, market: event.target.value, currency: event.target.value === "KR" ? "KRW" : "USD" })}><option>KR</option><option>US</option></select></label>
          <label>종목 코드<input disabled={Boolean(editingHoldingId)} required value={holdingForm.symbol} onChange={(event) => setHoldingForm({ ...holdingForm, symbol: event.target.value.toUpperCase() })} /></label>
          <label>종목명<input required value={holdingForm.name} onChange={(event) => setHoldingForm({ ...holdingForm, name: event.target.value })} /></label>
          <label>자산 유형<select disabled={Boolean(editingHoldingId)} value={holdingForm.assetType} onChange={(event) => setHoldingForm({ ...holdingForm, assetType: event.target.value })}><option value="stock">stock</option><option value="ETF">ETF</option><option value="fund">fund</option><option value="cash">cash</option></select></label>
          <label>수량<input required inputMode="decimal" value={holdingForm.quantity} onChange={(event) => setHoldingForm({ ...holdingForm, quantity: event.target.value })} /></label>
          <label>평균단가<input required inputMode="decimal" value={holdingForm.averagePrice} onChange={(event) => setHoldingForm({ ...holdingForm, averagePrice: event.target.value })} /></label>
          <label>통화<select disabled={Boolean(editingHoldingId)} value={holdingForm.currency} onChange={(event) => setHoldingForm({ ...holdingForm, currency: event.target.value })}><option>KRW</option><option>USD</option></select></label>
          <label>섹터<input required value={holdingForm.sector} onChange={(event) => setHoldingForm({ ...holdingForm, sector: event.target.value })} placeholder="예: 반도체" /></label>
          <label className="wide">투자 목적 메모<input value={holdingForm.note} onChange={(event) => setHoldingForm({ ...holdingForm, note: event.target.value })} /></label>
          <label className="portfolio-check"><input type="checkbox" checked={holdingForm.dividendTrackingEnabled} onChange={(event) => setHoldingForm({ ...holdingForm, dividendTrackingEnabled: event.target.checked })} />배당 추적</label>
          <div><button type="button" onClick={resetHoldingForm}>취소</button><button className="primary" disabled={working}>{editingHoldingId ? "수정 저장" : "종목 추가"}</button></div>
        </form> : null}
        <div className="portfolio-table-wrap"><table><thead><tr><th>시장</th><th><button onClick={() => selectSort("name")}>종목명·분류</button></th><th>수량</th><th>평균단가</th><th>현재가</th><th><button onClick={() => selectSort("marketValue")}>평가금액</button></th><th><button onClick={() => selectSort("profitLoss")}>손익</button></th><th><button onClick={() => selectSort("returnPercent")}>수익률</button></th><th><button onClick={() => selectSort("weightPercent")}>비중</button></th><th>예상 연간 배당</th><th>상태</th><th>관리</th></tr></thead><tbody>{sortedHoldings.length ? sortedHoldings.map((item) => <tr key={item.holding.id}><td><b className={`portfolio-market ${item.holding.market.toLowerCase()}`}>{item.holding.market}</b></td><td><strong>{item.holding.name}</strong><small>{item.holding.symbol} · {item.holding.assetType} · {item.holding.sector} · {item.holding.source === "toss" ? "토스증권 공식 API" : item.holding.source === "kis" ? "KIS 실계좌" : "수동/CSV"}</small>{item.holding.note ? <small className="portfolio-holding-analysis">{item.holding.note}</small> : null}</td><td>{formatNumber(item.holding.quantity, 8)}</td><td>{formatAmount(item.holding.averagePrice, item.holding.currency)}</td><td>{formatAmount(item.price.currentPrice, item.price.currency)}<small>{formatDate(item.price.observedAt, true)}</small></td><td>{formatAmount(item.baseMarketValue, dashboard.summary.baseCurrency)}</td><td className={(number(item.baseProfitLoss) ?? 0) >= 0 ? "gain" : "loss"}>{formatAmount(item.baseProfitLoss, dashboard.summary.baseCurrency)}{item.holding.currency === "USD" ? <small>USD {formatAmount(item.nativeProfitLoss, "USD")}</small> : null}</td><td className={(number(item.returnPercent) ?? 0) >= 0 ? "gain" : "loss"}>{formatPercent(item.returnPercent)}</td><td>{formatPercent(item.weightPercent)}</td><td>{formatAmount(item.expectedAnnualDividend, item.holding.currency)}<small>{item.dividendStatus}</small></td><td><span className={`portfolio-freshness ${item.price.freshnessStatus}`}>{item.price.freshnessStatus}</span>{item.provisional ? <small>잠정 평가</small> : null}</td><td>{item.holding.source === "toss" || item.holding.source === "kis" ? <span className="portfolio-readonly-badge">동기화 전용</span> : <div className="portfolio-row-actions"><button onClick={() => editHolding(item.holding)}>수정</button>{dashboard.accounts.length > 1 ? <select aria-label={`${item.holding.name} 계좌 이동`} value="" onChange={(event) => void moveHolding(item.holding.id, event.target.value)}><option value="">이동</option>{dashboard.accounts.filter((account) => account.id !== dashboard.account?.id).map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select> : null}<button className="danger" onClick={() => void deactivateHolding(item.holding)}>비활성화</button></div>}</td></tr>) : <tr><td colSpan={12}><p className="portfolio-empty-copy">등록된 활성 보유 종목이 없습니다. 실계좌 동기화, 종목 추가 또는 CSV 가져오기를 사용하세요.</p></td></tr>}</tbody></table></div>
      </section>

      <section className="portfolio-section" hidden={activeTab !== "holdings"}><header><div><span>ALLOCATION</span><h2>자산 배분</h2><p>확인 가능한 평가금액만 비중 계산에 포함합니다.</p></div></header><div className="portfolio-allocation-grid"><AllocationBars title="종목별" items={dashboard.allocations.holdings} /><AllocationBars title="섹터별" items={dashboard.allocations.sectors} /><AllocationBars title="시장별" items={dashboard.allocations.markets} /><AllocationBars title="통화별" items={dashboard.allocations.currencies} /></div></section>

      <section className="portfolio-section compact" hidden={activeTab !== "schedule"}>
        <header><div><span>SCHEDULE</span><h2>포트폴리오 일정</h2><p>자동 동기화 예정과 확인 가능한 배당 일정을 한곳에서 봅니다.</p></div></header>
        <div className="portfolio-schedule-grid">
          <article><small>다음 계좌 동기화</small><strong>{dashboard.autoSync.enabled ? formatDate(dashboard.autoSync.nextRunAt, true) : "자동 동기화 승인 대기 · OFF"}</strong><p>{dashboard.autoSync.cron} · {dashboard.autoSync.timezone}</p></article>
          <article><small>최근 계좌 동기화</small><strong>{formatDate(dashboard.accountSync.lastSyncedAt, true)}</strong><p>{dashboard.accountSync.lastSyncStatus ?? "기록 없음"}</p></article>
          {dashboard.dividends.filter((event) => event.exDividendDate || event.paymentDate).map((event) => <article key={`schedule-${event.id}`}><small>{event.symbol} · {event.status}</small><strong>{event.name}</strong><p>배당락 {formatDate(event.exDividendDate)} · 지급 {formatDate(event.paymentDate)}</p></article>)}
        </div>
      </section>

      <div className="portfolio-two-column portfolio-dividend-risk-tabs" hidden={activeTab !== "dividend" && activeTab !== "risk"}>
        <section className="portfolio-section compact"><header><div><span>DIVIDEND</span><h2>배당 일정</h2><p>확정 배당과 최근 분배금 연환산 추정치를 구분합니다. 옵션 ETF 분배금은 배당수익과 다를 수 있습니다.</p></div><button onClick={() => setShowDividendForm((value) => !value)}>수동 입력</button></header>{showDividendForm ? <form className="portfolio-dividend-form" onSubmit={submitDividend}><label>시장<select value={dividendForm.market} onChange={(event) => setDividendForm({ ...dividendForm, market: event.target.value, currency: event.target.value === "KR" ? "KRW" : "USD" })}><option>KR</option><option>US</option></select></label><label>종목 코드<input required value={dividendForm.symbol} onChange={(event) => setDividendForm({ ...dividendForm, symbol: event.target.value.toUpperCase() })} /></label><label>주당 예상 연간 배당금<input inputMode="decimal" value={dividendForm.amountPerShare} onChange={(event) => setDividendForm({ ...dividendForm, amountPerShare: event.target.value })} /></label><label>상태<select value={dividendForm.status} onChange={(event) => setDividendForm({ ...dividendForm, status: event.target.value })}><option value="confirmed">confirmed</option><option value="announced">announced</option><option value="estimated">estimated</option><option value="historical">historical</option><option value="unavailable">unavailable</option></select></label><label>배당락일<input type="date" value={dividendForm.exDividendDate} onChange={(event) => setDividendForm({ ...dividendForm, exDividendDate: event.target.value })} /></label><label>예상 지급일<input type="date" value={dividendForm.paymentDate} onChange={(event) => setDividendForm({ ...dividendForm, paymentDate: event.target.value })} /></label><label>출처<input value={dividendForm.sourceName} onChange={(event) => setDividendForm({ ...dividendForm, sourceName: event.target.value })} /></label><label>출처 URL<input type="url" value={dividendForm.sourceUrl} onChange={(event) => setDividendForm({ ...dividendForm, sourceUrl: event.target.value })} /></label><button className="primary" disabled={working}>등록</button></form> : null}<div className="portfolio-card-list">{dashboard.dividends.length ? dashboard.dividends.map((event) => <article key={event.id}><div><strong>{event.name} <small>{event.symbol}</small></strong><span className={`portfolio-dividend-status ${event.status}`}>{event.status}</span></div><p>{event.dividendType} · 주당 최근 {formatAmount(event.amountPerShare, event.currency)} · 주당 연환산 {formatAmount(event.annualizedAmountPerShare, event.currency)}</p><p>배당락 {formatDate(event.exDividendDate)} · 지급 {formatDate(event.paymentDate)}</p><b>보유수량 기준 연환산 {formatAmount(event.expectedAmount, event.currency)}</b>{event.sourceUrl ? <a href={event.sourceUrl} target="_blank" rel="noreferrer">{event.sourceName ?? "출처 확인"} ↗</a> : <small>출처 미입력 · 수동 확인 필요</small>}</article>) : <p className="portfolio-empty-copy">등록된 배당 일정이 없습니다. 미확인 날짜를 임의 생성하지 않습니다.</p>}</div></section>
        <section className="portfolio-section compact"><header><div><span>RISK SIGNALS</span><h2>위험 신호</h2><p>관찰과 확인을 위한 설명이며 매매 지시가 아닙니다.</p></div><b>{dashboard.risks.length}건</b></header><div className="portfolio-risk-list">{dashboard.risks.length ? dashboard.risks.map((risk) => <article key={risk.id} className={risk.severity}><i /><div><strong>{risk.title}</strong><p>{risk.message}</p><small>{risk.type} · {formatDate(risk.detectedAt, true)}</small></div></article>) : <p className="portfolio-empty-copy">현재 계산 가능한 규칙에서 위험 신호가 없습니다.</p>}</div></section>
      </div>

      <div className="portfolio-two-column portfolio-news-settings-tabs" hidden={activeTab !== "news" && activeTab !== "settings"}>
        <section className="portfolio-section compact"><header><div><span>NEWS REFERENCES</span><h2>보유 종목 뉴스</h2><p>제목·출처·발행일·URL과 자체 요약만 저장합니다.</p></div></header><div className="portfolio-news-list">{dashboard.news.length ? dashboard.news.map((item) => <a key={item.id} href={item.url} target="_blank" rel="noreferrer"><span>{item.symbol} · {item.riskCategory ?? "reference"}</span><strong>{item.title}</strong><p>{item.summary}</p><small>{item.sourceName} · {formatDate(item.publishedAt, true)} ↗</small></a>) : <p className="portfolio-empty-copy">뉴스 수집이 비활성화되어 있거나 확인 가능한 참고자료가 없습니다.</p>}</div></section>
        <section className="portfolio-section compact portfolio-briefing"><header><div><span>RULE-BASED REPORT</span><h2>자연어 브리핑</h2><p>LLM 비용 없이 계산 결과와 확인 항목만 요약합니다.</p></div></header><blockquote>{dashboard.briefing}</blockquote><div className="portfolio-quality"><strong>데이터 품질 · {dashboard.summary.dataQuality}</strong>{dashboard.summary.missingItems.length ? <ul>{dashboard.summary.missingItems.map((item) => <li key={item}>{item}</li>)}</ul> : <p>필수 계산 데이터 누락이 없습니다.</p>}</div></section>
      </div>

      <section className="portfolio-section portfolio-team"><header><div><span>MONITORING TEAM</span><h2>주식 모니터링팀 작업선</h2><p>기존 주식 담당 직원 토큰의 Task·AgentRun에 수동 갱신 결과를 연결하며 3D 좌표는 변경하지 않습니다.</p></div></header><div>{dashboard.team.map((member, index) => <article key={member.id}><b>{String(index + 1).padStart(2, "0")}</b><div><strong>{member.id}</strong><p>{member.role}</p></div><span>{member.status}</span></article>)}</div></section>
      </div>
    </>}
  </section>;
}
