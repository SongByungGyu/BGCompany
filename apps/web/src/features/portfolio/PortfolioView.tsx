"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  AllocationDto,
  HoldingValuationDto,
  PortfolioHoldingDto,
  PortfolioResponse,
} from "@/lib/portfolio/portfolio-types";
import {
  createDividendEvent,
  createPortfolioAccount,
  fetchPortfolio,
  refreshPortfolio,
  savePortfolioHolding,
  syncTossPortfolioAccount,
} from "./api";

type SortKey = "marketValue" | "profitLoss" | "returnPercent" | "weightPercent" | "name";

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
  const importRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async (nextAccountId?: string | null) => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchPortfolio(nextAccountId);
      setResponse(data);
      if (data.enabled && data.account) setAccountId(data.account.id);
    } catch (requestError) {
      setError(errorText(requestError));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

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
      if (data.dashboard.account) setAccountId(data.dashboard.account.id);
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
      <div><span>PHASE 2-P.1 · READ ONLY</span><h1>보유 종목·배당·리스크 대시보드</h1><p>토스증권 공식 Open API 또는 CSV로 실제 보유자산을 조회·계산·보고합니다. 주문, 계좌 제어, 매매 추천은 수행하지 않습니다.</p></div>
      <div className="portfolio-hero-actions">
        {dashboard?.accounts.length ? <select value={accountId ?? ""} onChange={(event) => { setAccountId(event.target.value); void load(event.target.value); }}>{dashboard.accounts.map((account) => <option key={account.id} value={account.id}>{account.name} · {account.baseCurrency}</option>)}</select> : null}
        <button onClick={() => setShowAccountForm((value) => !value)}>계좌 그룹</button>
        {dashboard?.accountSync.enabled ? <button className="primary" disabled={working || !dashboard.accountSync.configured} onClick={() => void onAccountSync()}>{working ? "처리 중" : "실계좌 동기화"}</button> : null}
        <button className="primary" disabled={working || !dashboard?.account} onClick={() => void onRefresh()}>{working ? "처리 중" : "수동 새로고침"}</button>
      </div>
    </header>
    {error ? <div className="portfolio-alert error"><strong>처리 실패</strong><span>{error}</span><button onClick={() => setError(null)}>닫기</button></div> : null}
    {notice ? <div className="portfolio-alert success"><strong>완료</strong><span>{notice}</span><button onClick={() => setNotice(null)}>닫기</button></div> : null}
    {dashboard?.accountSync.enabled ? <section className={`portfolio-account-sync ${dashboard.accountSync.configured ? "ready" : "missing"}`}><div><span>TOSS SECURITIES · OFFICIAL API · READ ONLY</span><strong>{dashboard.accountSync.configured ? `${dashboard.accountSync.maskedAccount} 연결 준비 완료` : "운영 서버에 Open API 발급값 설정 필요"}</strong><p>계좌목록과 보유종목 GET만 허용됩니다. 주문·정정·취소·이체 경로는 코드에서 차단합니다.</p></div><dl><div><dt>마지막 동기화</dt><dd>{formatDate(dashboard.accountSync.lastSyncedAt, true)}</dd></div><div><dt>상태</dt><dd>{dashboard.accountSync.lastSyncStatus ?? "대기"}</dd></div></dl></section> : null}
    {showAccountForm ? <form className="portfolio-inline-form" onSubmit={submitAccount}><label>계좌 별칭<input required value={accountForm.name} onChange={(event) => setAccountForm({ ...accountForm, name: event.target.value })} placeholder="예: 장기 투자" /></label><label>기준 통화<select value={accountForm.baseCurrency} onChange={(event) => setAccountForm({ ...accountForm, baseCurrency: event.target.value })}><option>KRW</option><option>USD</option></select></label><label className="wide">설명<input value={accountForm.description} onChange={(event) => setAccountForm({ ...accountForm, description: event.target.value })} placeholder="선택 입력" /></label><button className="primary" disabled={working}>생성</button></form> : null}
    {!dashboard?.account ? <section className="portfolio-first-step"><b>01</b><div><h2>{dashboard?.accountSync.enabled ? "토스증권 실계좌를 동기화하세요" : "첫 계좌 그룹을 만드세요"}</h2><p>{dashboard?.accountSync.enabled ? "공식 API로 실제 보유종목을 읽어 전용 계좌 그룹과 종목을 자동 생성합니다. 거래 기능은 없습니다." : "실제 보유 종목이나 금액은 자동으로 생성하지 않습니다."}</p></div>{dashboard?.accountSync.enabled ? <button className="primary" disabled={working || !dashboard.accountSync.configured} onClick={() => void onAccountSync()}>실계좌 동기화</button> : <button onClick={() => setShowAccountForm(true)}>계좌 그룹 만들기</button>}</section> : <>
      <div className="portfolio-summary-grid">
        <SummaryCard label="총 평가금액" value={formatAmount(dashboard.summary.totalMarketValue, dashboard.summary.baseCurrency)} detail={dashboard.summary.dataQuality === "verified" ? "확인 가능한 최신 데이터" : "잠정값 포함"} />
        <SummaryCard label="총 원가" value={formatAmount(dashboard.summary.totalCostBasis, dashboard.summary.baseCurrency)} />
        <SummaryCard label="평가손익" value={formatAmount(dashboard.summary.totalProfitLoss, dashboard.summary.baseCurrency)} tone={(number(dashboard.summary.totalProfitLoss) ?? 0) >= 0 ? "positive" : "negative"} />
        <SummaryCard label="전체 수익률" value={formatPercent(dashboard.summary.totalReturnPercent)} tone={(number(dashboard.summary.totalReturnPercent) ?? 0) >= 0 ? "positive" : "negative"} />
        <SummaryCard label="예상 연간 배당" value={formatAmount(dashboard.summary.expectedAnnualDividend, dashboard.summary.baseCurrency)} detail="확정·발표·추정 상태 구분" />
        <SummaryCard label="오늘 변동금액" value={formatAmount(dashboard.summary.todayChangeAmount, dashboard.summary.baseCurrency)} />
        <SummaryCard label="데이터 기준 시각" value={formatDate(dashboard.dataAsOf, true)} detail={dashboard.summary.exchangeRate ? `USD/KRW ${formatNumber(dashboard.summary.exchangeRate, 4)} · ${formatDate(dashboard.summary.exchangeRateAsOf, true)}` : "환율 사용 없음 또는 미확인"} />
      </div>

      <section className="portfolio-section">
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

      <section className="portfolio-section"><header><div><span>ALLOCATION</span><h2>자산 배분</h2><p>확인 가능한 평가금액만 비중 계산에 포함합니다.</p></div></header><div className="portfolio-allocation-grid"><AllocationBars title="종목별" items={dashboard.allocations.holdings} /><AllocationBars title="섹터별" items={dashboard.allocations.sectors} /><AllocationBars title="시장별" items={dashboard.allocations.markets} /><AllocationBars title="통화별" items={dashboard.allocations.currencies} /></div></section>

      <div className="portfolio-two-column">
        <section className="portfolio-section compact"><header><div><span>DIVIDEND</span><h2>배당 일정</h2><p>확정 배당과 최근 분배금 연환산 추정치를 구분합니다. 옵션 ETF 분배금은 배당수익과 다를 수 있습니다.</p></div><button onClick={() => setShowDividendForm((value) => !value)}>수동 입력</button></header>{showDividendForm ? <form className="portfolio-dividend-form" onSubmit={submitDividend}><label>시장<select value={dividendForm.market} onChange={(event) => setDividendForm({ ...dividendForm, market: event.target.value, currency: event.target.value === "KR" ? "KRW" : "USD" })}><option>KR</option><option>US</option></select></label><label>종목 코드<input required value={dividendForm.symbol} onChange={(event) => setDividendForm({ ...dividendForm, symbol: event.target.value.toUpperCase() })} /></label><label>주당 예상 연간 배당금<input inputMode="decimal" value={dividendForm.amountPerShare} onChange={(event) => setDividendForm({ ...dividendForm, amountPerShare: event.target.value })} /></label><label>상태<select value={dividendForm.status} onChange={(event) => setDividendForm({ ...dividendForm, status: event.target.value })}><option value="confirmed">confirmed</option><option value="announced">announced</option><option value="estimated">estimated</option><option value="historical">historical</option><option value="unavailable">unavailable</option></select></label><label>배당락일<input type="date" value={dividendForm.exDividendDate} onChange={(event) => setDividendForm({ ...dividendForm, exDividendDate: event.target.value })} /></label><label>예상 지급일<input type="date" value={dividendForm.paymentDate} onChange={(event) => setDividendForm({ ...dividendForm, paymentDate: event.target.value })} /></label><label>출처<input value={dividendForm.sourceName} onChange={(event) => setDividendForm({ ...dividendForm, sourceName: event.target.value })} /></label><label>출처 URL<input type="url" value={dividendForm.sourceUrl} onChange={(event) => setDividendForm({ ...dividendForm, sourceUrl: event.target.value })} /></label><button className="primary" disabled={working}>등록</button></form> : null}<div className="portfolio-card-list">{dashboard.dividends.length ? dashboard.dividends.map((event) => <article key={event.id}><div><strong>{event.name} <small>{event.symbol}</small></strong><span className={`portfolio-dividend-status ${event.status}`}>{event.status}</span></div><p>{event.dividendType} · 주당 최근 {formatAmount(event.amountPerShare, event.currency)} · 주당 연환산 {formatAmount(event.annualizedAmountPerShare, event.currency)}</p><p>배당락 {formatDate(event.exDividendDate)} · 지급 {formatDate(event.paymentDate)}</p><b>보유수량 기준 연환산 {formatAmount(event.expectedAmount, event.currency)}</b>{event.sourceUrl ? <a href={event.sourceUrl} target="_blank" rel="noreferrer">{event.sourceName ?? "출처 확인"} ↗</a> : <small>출처 미입력 · 수동 확인 필요</small>}</article>) : <p className="portfolio-empty-copy">등록된 배당 일정이 없습니다. 미확인 날짜를 임의 생성하지 않습니다.</p>}</div></section>
        <section className="portfolio-section compact"><header><div><span>RISK SIGNALS</span><h2>위험 신호</h2><p>관찰과 확인을 위한 설명이며 매매 지시가 아닙니다.</p></div><b>{dashboard.risks.length}건</b></header><div className="portfolio-risk-list">{dashboard.risks.length ? dashboard.risks.map((risk) => <article key={risk.id} className={risk.severity}><i /><div><strong>{risk.title}</strong><p>{risk.message}</p><small>{risk.type} · {formatDate(risk.detectedAt, true)}</small></div></article>) : <p className="portfolio-empty-copy">현재 계산 가능한 규칙에서 위험 신호가 없습니다.</p>}</div></section>
      </div>

      <div className="portfolio-two-column">
        <section className="portfolio-section compact"><header><div><span>NEWS REFERENCES</span><h2>보유 종목 뉴스</h2><p>제목·출처·발행일·URL과 자체 요약만 저장합니다.</p></div></header><div className="portfolio-news-list">{dashboard.news.length ? dashboard.news.map((item) => <a key={item.id} href={item.url} target="_blank" rel="noreferrer"><span>{item.symbol} · {item.riskCategory ?? "reference"}</span><strong>{item.title}</strong><p>{item.summary}</p><small>{item.sourceName} · {formatDate(item.publishedAt, true)} ↗</small></a>) : <p className="portfolio-empty-copy">뉴스 수집이 비활성화되어 있거나 확인 가능한 참고자료가 없습니다.</p>}</div></section>
        <section className="portfolio-section compact portfolio-briefing"><header><div><span>RULE-BASED REPORT</span><h2>자연어 브리핑</h2><p>LLM 비용 없이 계산 결과와 확인 항목만 요약합니다.</p></div></header><blockquote>{dashboard.briefing}</blockquote><div className="portfolio-quality"><strong>데이터 품질 · {dashboard.summary.dataQuality}</strong>{dashboard.summary.missingItems.length ? <ul>{dashboard.summary.missingItems.map((item) => <li key={item}>{item}</li>)}</ul> : <p>필수 계산 데이터 누락이 없습니다.</p>}</div></section>
      </div>

      <section className="portfolio-section portfolio-team"><header><div><span>MONITORING TEAM</span><h2>주식 모니터링팀 작업선</h2><p>기존 주식 담당 직원 토큰의 Task·AgentRun에 수동 갱신 결과를 연결하며 3D 좌표는 변경하지 않습니다.</p></div></header><div>{dashboard.team.map((member, index) => <article key={member.id}><b>{String(index + 1).padStart(2, "0")}</b><div><strong>{member.id}</strong><p>{member.role}</p></div><span>{member.status}</span></article>)}</div></section>
    </>}
  </section>;
}
