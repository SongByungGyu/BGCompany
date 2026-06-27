"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { DB_SYNC_INTERVAL_MS } from "@/lib/db-sync";
import { fetchContentPipelines, startContentPipeline } from "./api";
import { mockContentPipelines } from "./mock-content-pipeline";
import type { ContentChannel, ContentPipelineRun } from "./content-pipeline-types";

const channelLabels: Record<ContentChannel, string> = {
  blog: "블로그",
  instagram: "인스타그램",
  youtube: "유튜브",
  newsletter: "뉴스레터",
};

const statusLabels: Record<string, string> = {
  draft_requested: "초안 요청",
  planning: "기획 중",
  marketing_review: "마케팅 검토",
  qa_review: "QA 검토",
  director_approval: "Director 승인 대기",
  approved: "승인 완료",
  rejected: "반려/수정 필요",
  published_ready: "게시 준비",
  completed: "완료",
};

function formatTime(value: string) {
  return new Intl.DateTimeFormat("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value));
}

function statusGroup(status: string) {
  if (status === "completed" || status === "approved" || status === "published_ready") return "done";
  if (status === "rejected") return "error";
  if (status === "director_approval") return "waiting";
  return "working";
}

export function ContentPipelineView() {
  const [topic, setTopic] = useState("AI 개인회사 구축 과정 정리");
  const [title, setTitle] = useState("BG Company 구축기 1편");
  const [channel, setChannel] = useState<ContentChannel>("blog");
  const [runnerMode, setRunnerMode] = useState<"mock" | "hermes-dry-run" | "hermes">("mock");
  const [pipelines, setPipelines] = useState<ContentPipelineRun[]>(mockContentPipelines);
  const [selectedPipelineId, setSelectedPipelineId] = useState(mockContentPipelines[0]?.id ?? "");
  const [notice, setNotice] = useState("콘텐츠 파이프라인은 task / approval / event / timeline 조합으로 실행됩니다.");
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const data = await fetchContentPipelines();
      if (data.length > 0) {
        setPipelines(data);
        setSelectedPipelineId((current) => data.some((run) => run.id === current) ? current : data[0].id);
      }
      setError(null);
      return data;
    } catch (refreshError: unknown) {
      const message = refreshError instanceof Error ? refreshError.message : "알 수 없는 오류";
      setError(message);
      return pipelines;
    }
  }, [pipelines]);

  useEffect(() => {
    let cancelled = false;
    Promise.resolve().then(async () => {
      if (!cancelled) await refresh();
    });
    const intervalId = window.setInterval(() => {
      void refresh();
    }, DB_SYNC_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [refresh]);

  const selectedPipeline = useMemo(
    () => pipelines.find((pipeline) => pipeline.id === selectedPipelineId) ?? pipelines[0],
    [pipelines, selectedPipelineId],
  );

  const start = async () => {
    if (isBusy) return;
    setIsBusy(true);
    setNotice(`${title} · 콘텐츠 파이프라인을 실행 중입니다.`);
    try {
      const result = await startContentPipeline({ topic, title, channel, runnerMode });
      setPipelines((current) => [result.pipeline, ...current.filter((pipeline) => pipeline.id !== result.pipeline.id)]);
      setSelectedPipelineId(result.pipeline.id);
      setNotice(`${result.pipeline.title} · task ${result.pipeline.taskIds.length}개와 승인 요청이 생성되었습니다.`);
      setError(null);
      await refresh();
    } catch (startError: unknown) {
      const message = startError instanceof Error ? startError.message : "알 수 없는 오류";
      setError(message);
      setNotice(`콘텐츠 파이프라인 실행 실패 · ${message}`);
    } finally {
      setIsBusy(false);
    }
  };

  const counts = {
    total: pipelines.length,
    waiting: pipelines.filter((pipeline) => pipeline.status === "director_approval").length,
    done: pipelines.filter((pipeline) => pipeline.status === "completed").length,
  };

  return (
    <>
      <section className="stage">
        <div className="feature-shell content-pipeline-shell">
          <header className="feature-hero content-pipeline-hero">
            <div>
              <span>Phase 1-C</span>
              <h1>콘텐츠 파이프라인</h1>
              <p>기획 → 마케팅 검토 → QA 검토 → Director 승인 요청 흐름을 mock runner 기반으로 실행합니다.</p>
            </div>
            <div className="work-summary">
              <span><b>{counts.total}</b>전체</span>
              <span className="waiting"><b>{counts.waiting}</b>승인 대기</span>
              <span className="done"><b>{counts.done}</b>완료</span>
            </div>
          </header>

          <section className="content-pipeline-form">
            <label>주제<input value={topic} onChange={(event) => setTopic(event.target.value)} /></label>
            <label>제목<input value={title} onChange={(event) => setTitle(event.target.value)} /></label>
            <label>채널<select value={channel} onChange={(event) => setChannel(event.target.value as ContentChannel)}>
              {Object.entries(channelLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select></label>
            <label>Runner<select value={runnerMode} onChange={(event) => setRunnerMode(event.target.value as typeof runnerMode)}>
              <option value="mock">mock</option>
              <option value="hermes-dry-run">hermes-dry-run</option>
              <option value="hermes">hermes</option>
            </select></label>
            <button onClick={start} disabled={isBusy}>{isBusy ? "실행 중..." : "파이프라인 시작"}</button>
          </section>

          <div className="feature-toolbar">
            <p>{notice}</p>
            {error ? <p className="content-pipeline-error">오류: {error}</p> : null}
          </div>

          <div className="content-pipeline-layout">
            <section className="content-pipeline-list">
              {pipelines.map((pipeline) => (
                <button
                  key={pipeline.id}
                  className={pipeline.id === selectedPipeline?.id ? "selected" : ""}
                  onClick={() => setSelectedPipelineId(pipeline.id)}
                >
                  <span className={`badge compact ${statusGroup(pipeline.status)}`}>
                    <i className={`dot ${statusGroup(pipeline.status)}`} />{statusLabels[pipeline.status] ?? pipeline.status}
                  </span>
                  <strong>{pipeline.title}</strong>
                  <small>{channelLabels[pipeline.channel]} · {pipeline.topic}</small>
                  <em>{formatTime(pipeline.updatedAt)}</em>
                </button>
              ))}
            </section>
            <section className="content-pipeline-detail">
              {selectedPipeline ? (
                <>
                  <div className="feature-detail-head">
                    <span className={`badge ${statusGroup(selectedPipeline.status)}`}><i className={`dot ${statusGroup(selectedPipeline.status)}`} />{statusLabels[selectedPipeline.status] ?? selectedPipeline.status}</span>
                    <h2>{selectedPipeline.title}</h2>
                    <p>{channelLabels[selectedPipeline.channel]} · {selectedPipeline.topic}</p>
                  </div>
                  <div className="feature-card">
                    <label>현재 단계</label>
                    <strong>{selectedPipeline.currentStep}</strong>
                    <p>runner: {selectedPipeline.runnerMode ?? "mock"}</p>
                  </div>
                  <div className="feature-card">
                    <label>결과물 요약</label>
                    <strong>{selectedPipeline.outputTitle ?? "아직 결과물이 없습니다."}</strong>
                    <p>{selectedPipeline.outputSummary ?? "파이프라인을 실행하면 결과 요약이 생성됩니다."}</p>
                  </div>
                  <div className="feature-card">
                    <label>관련 업무 / 승인</label>
                    <ul className="audit-list">
                      {selectedPipeline.taskIds.map((taskId) => <li key={taskId}>task: {taskId}</li>)}
                      {selectedPipeline.approvalId ? <li>approval: {selectedPipeline.approvalId}</li> : null}
                    </ul>
                  </div>
                  <div className="timeline feature-timeline">
                    <article><i className="working" /><time>1</time><p>content-planner · 콘텐츠 기획</p></article>
                    <article><i className="working" /><time>2</time><p>marketing-manager · 제목/홍보 문구 검토</p></article>
                    <article><i className="working" /><time>3</time><p>qa-auditor · 사실성/정책/품질 검토</p></article>
                    <article><i className="waiting" /><time>4</time><p>director · 최종 승인 대기</p></article>
                  </div>
                </>
              ) : (
                <div className="feature-empty">표시할 콘텐츠 파이프라인이 없습니다.</div>
              )}
            </section>
          </div>
        </div>
      </section>
      <aside className="panel feature-detail-panel">
        <div className="feature-panel-tabs"><strong>콘텐츠 상세</strong><span>Phase 1-C</span></div>
        <div className="panel-body">
          <div className="feature-card">
            <label>연동 결과</label>
            <strong>업무 보드 · 승인함 · 3D 직원 상태 · DB timeline에 반영</strong>
            <p>파이프라인 실행 후 업무 보드에서 관련 task를, 승인함에서 Director 승인 요청을 확인할 수 있습니다.</p>
          </div>
          <div className="feature-card muted">
            <label>주의</label>
            <p>이번 단계에서는 실제 블로그 게시, 외부 메시지 발송, 실제 Hermes/LLM 실행은 하지 않습니다.</p>
          </div>
        </div>
      </aside>
    </>
  );
}
