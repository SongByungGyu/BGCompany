"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  OperationsCostBreakdown,
  OperationsHealth,
  OperationsListItem,
  OperationsMetric,
  OperationsOverview,
} from "@/lib/operations/operations-overview-types";
import { fetchOperationsOverview } from "./api";

export type OperationsWorkspaceScope = "report" | "development" | "finance";

const scopeConfig: Record<OperationsWorkspaceScope, { eyebrow: string; title: string; description: string; owner: string }> = {
  report: { eyebrow: "경영 보고", title: "운영 보고서", description: "오늘 완료한 업무와 대기·오류를 실제 운영 기록으로 정리합니다.", owner: "루나 · AI Director" },
  development: { eyebrow: "서비스 운영", title: "개발 관제", description: "Web·DB·Hermes·스케줄러·네이버 작업 상태를 한 화면에서 확인합니다.", owner: "준범 · 개발팀" },
  finance: { eyebrow: "실제 청구 비용", title: "재정 현황", description: "OpenAI 공식 비용·사용량 API와 Hermes 실행 기록을 분리해 확인합니다.", owner: "도윤 · 재정팀" },
};

const statusText: Record<OperationsHealth, string> = {
  healthy: "정상",
  warning: "확인 필요",
  critical: "오류",
  info: "정보",
  idle: "대기",
};

function formatTime(value: string) {
  return new Intl.DateTimeFormat("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

function MetricGrid({ metrics }: { metrics: OperationsMetric[] }) {
  return <div className="operations-metric-grid">{metrics.map((metric) => (
    <article key={metric.label} className={`operations-metric ${metric.tone}`}>
      <label>{metric.label}</label>
      <strong>{metric.value}</strong>
      <p>{metric.note}</p>
    </article>
  ))}</div>;
}

function OperationsList({ items, emptyText }: { items: OperationsListItem[]; emptyText: string }) {
  if (items.length === 0) return <p className="operations-empty">{emptyText}</p>;
  return <div className="operations-list">{items.map((entry) => {
    const content = <>
      <i className={`operations-tone ${entry.tone}`}/>
      <div><strong>{entry.title}</strong><p>{entry.detail}</p></div>
      <time>{formatTime(entry.timestamp)}</time>
    </>;
    return entry.href
      ? <a key={entry.id} href={entry.href} target="_blank" rel="noreferrer">{content}</a>
      : <article key={entry.id}>{content}</article>;
  })}</div>;
}

function Section({ eyebrow, title, count, children }: { eyebrow: string; title: string; count?: number; children: React.ReactNode }) {
  return <section className="operations-section">
    <header><div><span>{eyebrow}</span><h2>{title}</h2></div>{typeof count === "number" ? <b>{count}건</b> : null}</header>
    {children}
  </section>;
}

function formatCostAmount(amount: number) {
  return `$${amount.toFixed(amount > 0 && amount < 0.01 ? 4 : 2)}`;
}

function CostBars({ rows, emptyText }: { rows: OperationsCostBreakdown[]; emptyText: string }) {
  const max = Math.max(...rows.map((row) => row.amount), 1);
  if (rows.length === 0) return <p className="operations-empty">{emptyText}</p>;
  return <div className="operations-cost-list">{rows.map((row) => (
    <article key={row.id}>
      <div><strong>{row.label}</strong><b>{formatCostAmount(row.amount)}</b></div>
      <span><i style={{ width: `${Math.max((row.amount / max) * 100, 3)}%` }}/></span>
      <p>{row.detail}</p>
    </article>
  ))}</div>;
}

function ReportWorkspace({ overview }: { overview: OperationsOverview }) {
  const report = overview.report;
  return <>
    <MetricGrid metrics={report.metrics}/>
    <div className="operations-two-column">
      <Section eyebrow="완료 기록" title="오늘 진행된 결과" count={report.highlights.length}>
        <OperationsList items={report.highlights} emptyText="오늘 완료 기록이 아직 없습니다."/>
      </Section>
      <Section eyebrow="다음 행동" title="확인이 필요한 항목" count={report.openItems.length}>
        <OperationsList items={report.openItems} emptyText="현재 우선 확인할 항목이 없습니다."/>
      </Section>
    </div>
  </>;
}

function DevelopmentWorkspace({ overview }: { overview: OperationsOverview }) {
  const development = overview.development;
  return <>
    <div className="operations-service-grid">{development.services.map((entry) => (
      <article key={entry.id} className={entry.status}>
        <div><i/><span>{entry.label}</span></div>
        <strong>{entry.name}</strong>
        <p>{entry.detail}</p>
        <time>{formatTime(entry.checkedAt)} 확인</time>
      </article>
    ))}</div>
    <div className="operations-two-column">
      <Section eyebrow="오류 추적" title="최근 오류·차단 기록" count={development.incidents.length}>
        <OperationsList items={development.incidents} emptyText="최근 오류 기록이 없습니다."/>
      </Section>
      <Section eyebrow="AgentRun" title="최근 직원 실행" count={development.recentRuns.length}>
        <OperationsList items={development.recentRuns} emptyText="최근 AgentRun 기록이 없습니다."/>
      </Section>
    </div>
  </>;
}

function FinanceWorkspace({ overview }: { overview: OperationsOverview }) {
  const finance = overview.finance;
  const sourceTone = finance.providerStatus === "connected" ? "healthy" : finance.providerStatus === "forbidden" ? "critical" : "warning";
  return <>
    <div className={`operations-finance-source ${sourceTone}`}>
      <div><i/><span>{finance.providerStatus === "connected" ? "공식 비용 연결" : "비용 연결 확인 필요"}</span></div>
      <strong>{finance.source}</strong>
      <p>{finance.message}</p>
      <time>{formatTime(finance.collectedAt)} 동기화</time>
    </div>
    <MetricGrid metrics={finance.metrics}/>
    <div className="operations-two-column">
      <Section eyebrow="청구 항목" title="이번 달 실제 비용">
        <CostBars rows={finance.lineItemCosts} emptyText="실제 청구 항목이 없거나 Admin Key 연결이 필요합니다."/>
      </Section>
      <Section eyebrow="OpenAI 프로젝트" title="프로젝트별 실제 비용">
        <CostBars rows={finance.projectCosts} emptyText="프로젝트별 실제 비용이 아직 집계되지 않았습니다."/>
      </Section>
    </div>
  </>;
}

export function OperationsWorkspaceView({ scope }: { scope: OperationsWorkspaceScope }) {
  const config = scopeConfig[scope];
  const [overview, setOverview] = useState<OperationsOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setOverview(await fetchOperationsOverview());
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "운영 현황을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const initialTimer = window.setTimeout(() => void load(), 0);
    const timer = window.setInterval(() => void load(), 30_000);
    return () => {
      window.clearTimeout(initialTimer);
      window.clearInterval(timer);
    };
  }, [load]);

  const state = useMemo(() => {
    if (!overview) return { tone: "idle" as OperationsHealth, label: loading ? "불러오는 중" : "연결 대기", headline: "운영 데이터를 확인하고 있습니다." };
    if (scope === "report") {
      const tone = overview.report.openItems.some((entry) => entry.tone === "critical") ? "critical" : overview.report.openItems.length > 0 ? "warning" : "healthy";
      return { tone, label: statusText[tone], headline: overview.report.headline };
    }
    if (scope === "development") return { tone: overview.development.overallStatus, label: statusText[overview.development.overallStatus], headline: overview.development.headline };
    const providerStatus = overview.finance.providerStatus;
    const tone: OperationsHealth = providerStatus === "connected" ? "healthy" : providerStatus === "forbidden" ? "critical" : "warning";
    const label = providerStatus === "connected" ? "실비 연결" : providerStatus === "setup_required" ? "키 연결 필요" : statusText[tone];
    return { tone, label, headline: overview.finance.headline };
  }, [loading, overview, scope]);

  return <>
    <section className="stage">
      <div className="feature-shell operations-shell">
        <header className="feature-hero operations-hero">
          <div><span>{config.eyebrow}</span><h1>{config.title}</h1><p>{config.description}</p></div>
          <div className="operations-hero-actions">
            <div className={`operations-live-status ${state.tone}`}><i/><strong>{state.label}</strong></div>
            <button onClick={() => void load()} disabled={loading}>{loading ? "동기화 중" : "새로고침"}</button>
          </div>
        </header>
        {error ? <div className="operations-error"><strong>데이터 연결 실패</strong><span>{error}</span><button onClick={() => void load()}>다시 시도</button></div> : null}
        {overview ? (
          scope === "report" ? <ReportWorkspace overview={overview}/>
            : scope === "development" ? <DevelopmentWorkspace overview={overview}/>
              : <FinanceWorkspace overview={overview}/>
        ) : <div className="operations-loading"><i/><strong>운영 기록을 불러오는 중입니다.</strong></div>}
      </div>
    </section>
    <aside className="panel feature-detail-panel operations-detail-panel">
      <div className="feature-panel-tabs"><strong>{config.title} 요약</strong><span>{scope === "finance" ? "공식 API" : "실제 DB"}</span></div>
      <div className="panel-body">
        <div className="feature-card operations-side-head"><label>현재 판단</label><strong>{state.headline}</strong>{overview ? <p>{formatTime(overview.generatedAt)} 기준</p> : null}</div>
        <div className="feature-card"><label>담당 직원</label><strong>{config.owner}</strong><p>30초마다 운영 데이터를 자동으로 갱신합니다.</p></div>
        {scope === "report" && overview ? <div className="feature-card"><label>오늘 요약</label><p>{overview.report.summary}</p></div> : null}
        {scope === "development" && overview ? <div className="feature-card"><label>서비스 상태</label>{overview.development.services.map((entry) => <p key={entry.id}>• {entry.name}: {entry.label}</p>)}</div> : null}
        {scope === "finance" && overview ? <div className="feature-card"><label>비용 데이터 상태</label><strong>{overview.finance.source}</strong><p>{overview.finance.message}</p></div> : null}
        {scope === "finance" && overview ? <div className="feature-card muted"><label>집계 기준</label><p>{overview.finance.note}</p></div> : null}
      </div>
    </aside>
  </>;
}
