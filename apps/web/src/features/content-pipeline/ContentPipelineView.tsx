"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { DB_SYNC_INTERVAL_MS } from "@/lib/db-sync";
import { fetchContentPipeline, fetchContentPipelines, fetchHermesUsage, startContentPipeline } from "./api";
import { mockContentPipelines } from "./mock-content-pipeline";
import type { ContentChannel, ContentPipelineDetail, ContentPipelineRun, HermesUsageSummary } from "./content-pipeline-types";

const channelLabels: Record<ContentChannel, string> = {
  blog: "블로그",
  instagram: "인스타그램",
  youtube: "유튜브",
  newsletter: "뉴스레터",
};

const HERMES_PIPELINE_REQUIRED_RUNS = 4;

const statusLabels: Record<string, string> = {
  draft_requested: "초안 요청",
  planning: "기획 중",
  marketing_review: "마케팅 검토",
  content_writing: "본문 작성",
  qa_review: "QA 검토",
  director_approval: "Director 승인 대기",
  approved: "승인 완료",
  rejected: "반려",
  revision_requested: "수정 요청",
  published_ready: "게시 준비",
  completed: "완료",
};

function formatTime(value: string) {
  return new Intl.DateTimeFormat("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value));
}

function formatDurationMs(value?: number | null) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  if (value < 1000) return `${Math.round(value)}ms`;
  return `${Math.round(value / 100) / 10}\uCD08`;
}

function statusGroup(status: string) {
  if (status === "completed" || status === "approved" || status === "published_ready") return "done";
  if (status === "rejected") return "error";
  if (status === "director_approval") return "waiting";
  return "working";
}

function stringifyJson(value: unknown) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return "표시할 수 없는 payload입니다.";
  }
}

function parseStatusLabel(value?: string) {
  if (value === "json") return "JSON 정상";
  if (value === "json_extracted") return "JSON 추출";
  if (value === "fallback_text") return "원문 fallback";
  return "미확인";
}

function listResultGaps(result: ContentPipelineRun["plannerResult"]) {
  if (!result || result.ok === false) return [];
  const gaps: string[] = [];
  if (!result.title) gaps.push("title");
  if (!result.summary) gaps.push("summary");
  if (!result.outline?.length) gaps.push("outline");
  if (!result.content && !result.draftDirection) gaps.push("content/draftDirection");
  return gaps;
}

function listMarketingResultGaps(result: ContentPipelineRun["marketingResult"]) {
  if (!result || result.ok === false) return [];
  const gaps: string[] = [];
  if (!result.reviewSummary) gaps.push("reviewSummary");
  if (!result.recommendedTitle) gaps.push("recommendedTitle");
  if (!result.titleSuggestions?.length) gaps.push("titleSuggestions");
  if (!result.seoKeywords?.length) gaps.push("seoKeywords");
  return gaps;
}

function listWriterResultGaps(result: ContentPipelineRun["writerResult"]) {
  if (!result || result.ok === false) return [];
  const gaps: string[] = [];
  if (!result.finalTitle) gaps.push("finalTitle");
  if (!result.metaDescription) gaps.push("metaDescription");
  if (!result.sections?.length) gaps.push("sections");
  if (!result.fullDraft && !result.markdownDraft) gaps.push("fullDraft/markdownDraft");
  return gaps;
}

function listQaResultGaps(result: ContentPipelineRun["qaResult"]) {
  if (!result || result.ok === false) return [];
  const gaps: string[] = [];
  if (!result.qaSummary) gaps.push("qaSummary");
  if (!result.factCheckNotes?.length) gaps.push("factCheckNotes");
  if (!result.qualityNotes?.length) gaps.push("qualityNotes");
  if (!result.riskNotes?.length) gaps.push("riskNotes");
  if (!result.finalRecommendation) gaps.push("finalRecommendation");
  return gaps;
}

function PlannerResultCard({ pipeline, agentRuns }: { pipeline: ContentPipelineRun; agentRuns: NonNullable<ContentPipelineDetail["agentRuns"]> }) {
  const plannerRun = agentRuns.find((run) => run.employeeId === "content-planner");
  const payload = pipeline.hermesRequestPayload ?? plannerRun?.metadata?.hermesPayload;
  const result = pipeline.plannerResult;
  const isHermesMode = pipeline.runnerMode === "hermes" || pipeline.runnerMode === "hermes-dry-run";
  const isFailed = plannerRun?.status === "failed" || result?.ok === false;
  const gaps = listResultGaps(result);
  const hasFallback = result?.parseStatus === "fallback_text";
  const rawText = result?.rawText;
  const durationLabel = formatDurationMs(result?.durationMs);

  return (
    <div className="feature-card content-pipeline-result-card">
      <label>content-planner 실행 결과</label>
      <strong>{plannerRun?.status ?? (isFailed ? "failed" : "ready")} · {pipeline.runnerMode ?? "mock"}</strong>
      <div className="content-pipeline-meta">
        <span>provider: {result?.provider ?? pipeline.runnerMode ?? "mock"}</span>
        <span>parse: {parseStatusLabel(result?.parseStatus)}</span>
        {durationLabel ? <span>{durationLabel}</span> : null}
      </div>
      {isFailed ? (
        <p className="content-pipeline-error">{result?.errorCode ?? "HERMES_ERROR"} · {plannerRun?.errorMessage ?? result?.errorMessage ?? "Hermes 실행에 실패했습니다."}</p>
      ) : (
        <p>{plannerRun?.resultSummary ?? result?.summary ?? pipeline.outputSummary ?? "기획 결과를 기다리는 중입니다."}</p>
      )}
      {hasFallback ? <p className="content-pipeline-warning">Hermes 응답이 완전한 JSON은 아니어서 원문을 fallback 결과로 저장했습니다. 필요하면 payload와 원문을 확인해주세요.</p> : null}
      {!isFailed && gaps.length ? <p className="content-pipeline-warning">응답은 저장됐지만 일부 필드가 비어 있습니다: {gaps.join(", ")}</p> : null}

      {result ? (
        <div className="content-pipeline-result-grid">
          {result.title ? <div><label>제목</label><strong>{result.title}</strong></div> : null}
          {result.summary ? <div><label>요약</label><p>{result.summary}</p></div> : null}
          {result.targetAudience ? <div><label>타깃</label><p>{result.targetAudience}</p></div> : null}
          {result.tone ? <div><label>톤</label><p>{result.tone}</p></div> : null}
          {result.seoKeywords?.length ? <div className="content-pipeline-result-block"><label>SEO 키워드</label><div className="content-pipeline-keywords">{result.seoKeywords.map((keyword) => <span key={keyword}>{keyword}</span>)}</div></div> : null}
          {result.outline?.length ? <div className="content-pipeline-result-block"><label>개요</label><ul className="content-pipeline-outline">{result.outline.map((item) => <li key={item}>{item}</li>)}</ul></div> : null}
          {result.thumbnailIdea ? <div className="content-pipeline-result-block"><label>썸네일 아이디어</label><p>{result.thumbnailIdea}</p></div> : null}
          {result.draftDirection ? <div className="content-pipeline-result-block"><label>초안 방향</label><p>{result.draftDirection}</p></div> : null}
          {result.content ? <div className="content-pipeline-result-block"><label>본문/초안</label><p>{result.content}</p></div> : null}
          {result.cta ? <div className="content-pipeline-result-block"><label>CTA</label><p>{result.cta}</p></div> : null}
        </div>
      ) : null}

      {rawText ? (
        <details className="content-pipeline-payload">
          <summary>Hermes raw/fallback text 보기</summary>
          <pre>{rawText}</pre>
        </details>
      ) : null}
      {isHermesMode && payload ? (
        <details className="content-pipeline-payload">
          <summary>Hermes Bridge request payload 보기</summary>
          <pre>{stringifyJson(payload)}</pre>
        </details>
      ) : null}
    </div>
  );
}


function MarketingResultCard({ pipeline, agentRuns }: { pipeline: ContentPipelineRun; agentRuns: NonNullable<ContentPipelineDetail["agentRuns"]> }) {
  const marketingRun = agentRuns.find((run) => run.employeeId === "marketing-manager");
  const payload = pipeline.hermesMarketingRequestPayload ?? marketingRun?.metadata?.hermesPayload;
  const result = pipeline.marketingResult;
  const isHermesMode = pipeline.runnerMode === "hermes" || pipeline.runnerMode === "hermes-dry-run";
  const isFailed = marketingRun?.status === "failed" || result?.ok === false;
  const gaps = listMarketingResultGaps(result);
  const hasFallback = result?.parseStatus === "fallback_text";
  const rawText = result?.rawText;
  const durationLabel = formatDurationMs(result?.durationMs);

  return (
    <div className="feature-card content-pipeline-result-card">
      <label>marketing-manager 실행 결과</label>
      <strong>{marketingRun?.status ?? (isFailed ? "failed" : "ready")} · {marketingRun?.mode ?? pipeline.runnerMode ?? "mock"}</strong>
      <div className="content-pipeline-meta">
        <span>provider: {result?.provider ?? marketingRun?.mode ?? pipeline.runnerMode ?? "mock"}</span>
        <span>parse: {parseStatusLabel(result?.parseStatus)}</span>
        {durationLabel ? <span>{durationLabel}</span> : null}
      </div>
      {isFailed ? (
        <p className="content-pipeline-error">{result?.errorCode ?? "MARKETING_ERROR"} · {marketingRun?.errorMessage ?? result?.errorMessage ?? "marketing-manager 실행에 실패했습니다."}</p>
      ) : (
        <p>{marketingRun?.resultSummary ?? result?.reviewSummary ?? "마케팅 검토 결과를 기다리는 중입니다."}</p>
      )}
      {hasFallback ? <p className="content-pipeline-warning">Hermes 응답이 완전한 JSON은 아니어서 원문을 fallback 결과로 저장했습니다.</p> : null}
      {!isFailed && gaps.length ? <p className="content-pipeline-warning">응답은 저장됐지만 일부 필드가 비어 있습니다: {gaps.join(", ")}</p> : null}

      {result ? (
        <div className="content-pipeline-result-grid">
          {result.recommendedTitle ? <div><label>추천 제목</label><strong>{result.recommendedTitle}</strong></div> : null}
          {typeof result.marketingScore === "number" ? <div><label>마케팅 점수</label><strong>{result.marketingScore}/100</strong></div> : null}
          {result.finalRecommendation ? <div><label>최종 판단</label><strong>{result.finalRecommendation}</strong></div> : null}
          {result.reviewSummary ? <div className="content-pipeline-result-block"><label>검토 요약</label><p>{result.reviewSummary}</p></div> : null}
          {result.titleSuggestions?.length ? <div className="content-pipeline-result-block"><label>제목 후보</label><ul className="content-pipeline-outline">{result.titleSuggestions.map((item) => <li key={item}>{item}</li>)}</ul></div> : null}
          {result.thumbnailCopy ? <div className="content-pipeline-result-block"><label>썸네일 문구</label><p>{result.thumbnailCopy}</p></div> : null}
          {result.seoKeywords?.length ? <div className="content-pipeline-result-block"><label>SEO 키워드</label><div className="content-pipeline-keywords">{result.seoKeywords.map((keyword) => <span key={keyword}>{keyword}</span>)}</div></div> : null}
          {result.introHook ? <div className="content-pipeline-result-block"><label>도입부 hook</label><p>{result.introHook}</p></div> : null}
          {result.promotionCopy?.short || result.promotionCopy?.long ? <div className="content-pipeline-result-block"><label>홍보 문구</label><p>{result.promotionCopy.short}</p><p>{result.promotionCopy.long}</p></div> : null}
          {result.clickPoints?.length ? <div className="content-pipeline-result-block"><label>클릭 포인트</label><ul className="content-pipeline-outline">{result.clickPoints.map((item) => <li key={item}>{item}</li>)}</ul></div> : null}
          {result.riskNotes?.length ? <div className="content-pipeline-result-block"><label>리스크</label><ul className="content-pipeline-outline">{result.riskNotes.map((item) => <li key={item}>{item}</li>)}</ul></div> : null}
          {result.improvementSuggestions?.length ? <div className="content-pipeline-result-block"><label>개선 제안</label><ul className="content-pipeline-outline">{result.improvementSuggestions.map((item) => <li key={item}>{item}</li>)}</ul></div> : null}
          {result.reason ? <div className="content-pipeline-result-block"><label>판단 이유</label><p>{result.reason}</p></div> : null}
        </div>
      ) : null}

      {rawText ? (
        <details className="content-pipeline-payload">
          <summary>Hermes marketing raw/fallback text 보기</summary>
          <pre>{rawText}</pre>
        </details>
      ) : null}
      {isHermesMode && payload ? (
        <details className="content-pipeline-payload">
          <summary>Hermes Marketing request payload 보기</summary>
          <pre>{stringifyJson(payload)}</pre>
        </details>
      ) : null}
    </div>
  );
}

function WriterResultCard({ pipeline, agentRuns }: { pipeline: ContentPipelineRun; agentRuns: NonNullable<ContentPipelineDetail["agentRuns"]> }) {
  const writerRun = agentRuns.find((run) => run.employeeId === "content-writer");
  const payload = pipeline.hermesWriterRequestPayload ?? writerRun?.metadata?.hermesPayload;
  const result = pipeline.writerResult;
  const isHermesMode = pipeline.runnerMode === "hermes" || pipeline.runnerMode === "hermes-dry-run";
  const isFailed = writerRun?.status === "failed" || result?.ok === false;
  const gaps = listWriterResultGaps(result);
  const hasFallback = result?.parseStatus === "fallback_text";
  const rawText = result?.rawText;
  const durationLabel = formatDurationMs(result?.durationMs);

  return (
    <div className="feature-card content-pipeline-result-card">
      <label>content-writer 실행 결과</label>
      <strong>{writerRun?.status ?? (isFailed ? "failed" : "ready")} · {writerRun?.mode ?? pipeline.runnerMode ?? "mock"}</strong>
      <div className="content-pipeline-meta">
        <span>provider: {result?.provider ?? writerRun?.mode ?? pipeline.runnerMode ?? "mock"}</span>
        <span>parse: {parseStatusLabel(result?.parseStatus)}</span>
        {durationLabel ? <span>{durationLabel}</span> : null}
      </div>
      {isFailed ? (
        <p className="content-pipeline-error">{result?.errorCode ?? "WRITER_ERROR"} · {writerRun?.errorMessage ?? result?.errorMessage ?? "content-writer 실행에 실패했습니다."}</p>
      ) : (
        <p>{writerRun?.resultSummary ?? result?.metaDescription ?? result?.introduction ?? "본문 작성 결과를 기다리는 중입니다."}</p>
      )}
      {hasFallback ? <p className="content-pipeline-warning">Hermes 응답이 완전한 JSON은 아니어서 원문을 fallback 결과로 저장했습니다.</p> : null}
      {!isFailed && gaps.length ? <p className="content-pipeline-warning">응답은 저장됐지만 일부 필드가 비어 있습니다: {gaps.join(", ")}</p> : null}

      {result ? (
        <div className="content-pipeline-result-grid">
          {result.finalTitle ? <div><label>최종 제목</label><strong>{result.finalTitle}</strong></div> : null}
          {result.metaDescription ? <div className="content-pipeline-result-block"><label>메타 설명</label><p>{result.metaDescription}</p></div> : null}
          {result.introduction ? <div className="content-pipeline-result-block"><label>도입부</label><p>{result.introduction}</p></div> : null}
          {result.sections?.length ? <div className="content-pipeline-result-block"><label>본문 섹션</label><ul className="content-pipeline-outline">{result.sections.map((section, index) => <li key={`${section.heading}-${index}`}><strong>{section.heading}</strong><p>{section.body}</p></li>)}</ul></div> : null}
          {result.conclusion ? <div className="content-pipeline-result-block"><label>결론</label><p>{result.conclusion}</p></div> : null}
          {result.cta ? <div className="content-pipeline-result-block"><label>CTA</label><p>{result.cta}</p></div> : null}
          {result.usedSeoKeywords?.length ? <div className="content-pipeline-result-block"><label>사용 키워드</label><div className="content-pipeline-keywords">{result.usedSeoKeywords.map((keyword) => <span key={keyword}>{keyword}</span>)}</div></div> : null}
          {result.writingNotes?.length ? <div className="content-pipeline-result-block"><label>작성 메모</label><ul className="content-pipeline-outline">{result.writingNotes.map((item) => <li key={item}>{item}</li>)}</ul></div> : null}
          {result.markdownDraft || result.fullDraft ? <div className="content-pipeline-result-block"><label>게시 초안</label><pre className="content-pipeline-draft">{result.markdownDraft ?? result.fullDraft}</pre></div> : null}
        </div>
      ) : null}

      {rawText ? (
        <details className="content-pipeline-payload">
          <summary>Hermes writer raw/fallback text 보기</summary>
          <pre>{rawText}</pre>
        </details>
      ) : null}
      {isHermesMode && payload ? (
        <details className="content-pipeline-payload">
          <summary>Hermes Writer request payload 보기</summary>
          <pre>{stringifyJson(payload)}</pre>
        </details>
      ) : null}
    </div>
  );
}

function QaResultCard({ pipeline, agentRuns }: { pipeline: ContentPipelineRun; agentRuns: NonNullable<ContentPipelineDetail["agentRuns"]> }) {
  const qaRun = agentRuns.find((run) => run.employeeId === "qa-auditor");
  const payload = pipeline.hermesQaRequestPayload ?? qaRun?.metadata?.hermesPayload;
  const result = pipeline.qaResult;
  const isHermesMode = pipeline.runnerMode === "hermes" || pipeline.runnerMode === "hermes-dry-run";
  const isFailed = qaRun?.status === "failed" || result?.ok === false;
  const gaps = listQaResultGaps(result);
  const hasFallback = result?.parseStatus === "fallback_text";
  const rawText = result?.rawText;
  const durationLabel = formatDurationMs(result?.durationMs);

  return (
    <div className="feature-card content-pipeline-result-card">
      <label>qa-auditor 실행 결과</label>
      <strong>{qaRun?.status ?? (isFailed ? "failed" : "ready")} · {qaRun?.mode ?? pipeline.runnerMode ?? "mock"}</strong>
      <div className="content-pipeline-meta">
        <span>provider: {result?.provider ?? qaRun?.mode ?? pipeline.runnerMode ?? "mock"}</span>
        <span>parse: {parseStatusLabel(result?.parseStatus)}</span>
        {durationLabel ? <span>{durationLabel}</span> : null}
      </div>
      {isFailed ? (
        <p className="content-pipeline-error">{result?.errorCode ?? "QA_ERROR"} · {qaRun?.errorMessage ?? result?.errorMessage ?? "qa-auditor 실행에 실패했습니다."}</p>
      ) : (
        <p>{qaRun?.resultSummary ?? result?.qaSummary ?? "QA 검토 결과를 기다리는 중입니다."}</p>
      )}
      {hasFallback ? <p className="content-pipeline-warning">Hermes 응답이 완전한 JSON은 아니어서 원문을 fallback 결과로 저장했습니다.</p> : null}
      {!isFailed && gaps.length ? <p className="content-pipeline-warning">응답은 저장됐지만 일부 필드가 비어 있습니다: {gaps.join(", ")}</p> : null}

      {result ? (
        <div className="content-pipeline-result-grid">
          {typeof result.qaScore === "number" ? <div><label>QA 점수</label><strong>{result.qaScore}/100</strong></div> : null}
          {result.publishReadiness ? <div><label>게시 준비도</label><strong>{result.publishReadiness}</strong></div> : null}
          {result.finalRecommendation ? <div><label>최종 판단</label><strong>{result.finalRecommendation}</strong></div> : null}
          {result.qaSummary ? <div className="content-pipeline-result-block"><label>QA 요약</label><p>{result.qaSummary}</p></div> : null}
          {result.factCheckNotes?.length ? <div className="content-pipeline-result-block"><label>사실성 검토</label><ul className="content-pipeline-outline">{result.factCheckNotes.map((item) => <li key={item}>{item}</li>)}</ul></div> : null}
          {result.qualityNotes?.length ? <div className="content-pipeline-result-block"><label>품질 검토</label><ul className="content-pipeline-outline">{result.qualityNotes.map((item) => <li key={item}>{item}</li>)}</ul></div> : null}
          {result.riskNotes?.length ? <div className="content-pipeline-result-block"><label>리스크</label><ul className="content-pipeline-outline">{result.riskNotes.map((item) => <li key={item}>{item}</li>)}</ul></div> : null}
          {result.typoAndStyleNotes?.length ? <div className="content-pipeline-result-block"><label>문장/스타일</label><ul className="content-pipeline-outline">{result.typoAndStyleNotes.map((item) => <li key={item}>{item}</li>)}</ul></div> : null}
          {result.requiredRevisions?.length ? <div className="content-pipeline-result-block"><label>필수 수정</label><ul className="content-pipeline-outline">{result.requiredRevisions.map((item) => <li key={item}>{item}</li>)}</ul></div> : null}
          {result.optionalSuggestions?.length ? <div className="content-pipeline-result-block"><label>선택 개선</label><ul className="content-pipeline-outline">{result.optionalSuggestions.map((item) => <li key={item}>{item}</li>)}</ul></div> : null}
          {result.reason ? <div className="content-pipeline-result-block"><label>판단 이유</label><p>{result.reason}</p></div> : null}
        </div>
      ) : null}

      {rawText ? (
        <details className="content-pipeline-payload">
          <summary>Hermes QA raw/fallback text 보기</summary>
          <pre>{rawText}</pre>
        </details>
      ) : null}
      {isHermesMode && payload ? (
        <details className="content-pipeline-payload">
          <summary>Hermes QA request payload 보기</summary>
          <pre>{stringifyJson(payload)}</pre>
        </details>
      ) : null}
    </div>
  );
}

function ApprovedResultCard({ pipeline, approval }: { pipeline: ContentPipelineRun; approval: ContentPipelineDetail["approval"] }) {
  const planner = pipeline.plannerResult;
  const writer = pipeline.writerResult;
  const isApproved = pipeline.status === "approved" || pipeline.status === "published_ready" || pipeline.status === "completed";
  if (!isApproved) return null;
  const approvedTitle = writer?.finalTitle ?? pipeline.outputTitle ?? planner?.title ?? pipeline.title;
  const approvedSummary = writer?.metaDescription ?? pipeline.outputSummary ?? planner?.summary ?? "Director 승인이 완료된 콘텐츠 결과입니다.";
  const approvedDraft = writer?.markdownDraft ?? writer?.fullDraft ?? planner?.content;
  return (
    <div className="feature-card content-pipeline-approved">
      <label>승인 완료 결과물</label>
      <strong>{approvedTitle}</strong>
      <p>{approvedSummary}</p>
      {writer?.sections?.length ? (
        <ul className="content-pipeline-outline">
          {writer.sections.map((section, index) => <li key={`${section.heading}-${index}`}><strong>{section.heading}</strong><p>{section.body}</p></li>)}
        </ul>
      ) : null}
      {approvedDraft ? <pre className="content-pipeline-draft">{approvedDraft}</pre> : null}
      {writer?.usedSeoKeywords?.length ? <div className="content-pipeline-keywords">{writer.usedSeoKeywords.map((keyword) => <span key={keyword}>{keyword}</span>)}</div> : null}
      <small>승인 상태: {approval?.status ?? "승인 완료"} · 최종 갱신 {formatTime(pipeline.updatedAt)}</small>
    </div>
  );
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
  const [detail, setDetail] = useState<ContentPipelineDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [hermesUsage, setHermesUsage] = useState<HermesUsageSummary | null>(null);
  const [hermesUsageError, setHermesUsageError] = useState<string | null>(null);

  const refreshHermesUsage = useCallback(async () => {
    try {
      const usage = await fetchHermesUsage();
      setHermesUsage(usage);
      setHermesUsageError(null);
      return usage;
    } catch (fetchError: unknown) {
      const message = fetchError instanceof Error ? fetchError.message : "Hermes 사용량을 불러오지 못했습니다.";
      setHermesUsageError(message);
      return null;
    }
  }, []);

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
      if (!cancelled) {
        await refresh();
        await refreshHermesUsage();
      }
    });
    const intervalId = window.setInterval(() => {
      void refresh();
      void refreshHermesUsage();
    }, DB_SYNC_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [refresh, refreshHermesUsage]);

  const selectedPipeline = useMemo(
    () => pipelines.find((pipeline) => pipeline.id === selectedPipelineId) ?? pipelines[0],
    [pipelines, selectedPipelineId],
  );
  const isHermesSelected = runnerMode === "hermes";
  const isHermesBlocked = isHermesSelected && Boolean(hermesUsage && hermesUsage.remaining < HERMES_PIPELINE_REQUIRED_RUNS);

  useEffect(() => {
    if (!selectedPipeline?.id) return;
    let cancelled = false;
    Promise.resolve()
      .then(() => fetchContentPipeline(selectedPipeline.id))
      .then((data) => {
        if (cancelled) return;
        setDetail(data);
        setDetailError(null);
      })
      .catch((detailFetchError: unknown) => {
        if (cancelled) return;
        const message = detailFetchError instanceof Error ? detailFetchError.message : "알 수 없는 오류";
        setDetail(null);
        setDetailError(message);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedPipeline?.id]);

  const start = async () => {
    if (isBusy) return;
    if (runnerMode === "hermes") {
      const latestUsage = await refreshHermesUsage();
      if (latestUsage && latestUsage.remaining < HERMES_PIPELINE_REQUIRED_RUNS) {
        setError(`HERMES_DAILY_LIMIT_EXCEEDED: 이번 파이프라인은 ${HERMES_PIPELINE_REQUIRED_RUNS}회가 필요하지만 현재 ${latestUsage.remaining}회만 남아 있습니다.`);
        setNotice("Hermes 일일 실행 한도가 부족해 실제 실행을 시작하지 않았습니다. mock 또는 hermes-dry-run을 사용하세요.");
        return;
      }
      const remainingText = latestUsage
        ? `오늘 남은 Hermes 실행 가능 횟수: ${latestUsage.remaining} / ${latestUsage.limit}회`
        : "Hermes 사용량을 확인하지 못했습니다.";
      const confirmed = window.confirm(
        `Hermes 실제 실행은 OpenAI API 비용이 발생할 수 있습니다.\n${remainingText}\n\n이번 실행은 content-planner, marketing-manager, content-writer, qa-auditor를 각 1회씩 최대 ${HERMES_PIPELINE_REQUIRED_RUNS}회 Hermes Bridge로 실행합니다. 계속 실행할까요?`,
      );
      if (!confirmed) {
        setNotice("Hermes 실제 실행을 취소했습니다. 비용 없는 검증은 mock 또는 hermes-dry-run을 사용하세요.");
        return;
      }
    }
    setIsBusy(true);
    setNotice(`${title} · 콘텐츠 파이프라인을 실행 중입니다.`);
    try {
      const result = await startContentPipeline({ topic, title, channel, runnerMode });
      setPipelines((current) => [result.pipeline, ...current.filter((pipeline) => pipeline.id !== result.pipeline.id)]);
      setSelectedPipelineId(result.pipeline.id);
      setNotice(`${result.pipeline.title} · task ${result.pipeline.taskIds.length}개와 승인 요청이 생성되었습니다.`);
      setError(null);
      await refresh();
      await refreshHermesUsage();
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
              <p>기획 → 마케팅 검토 → 본문 작성 → QA 검토 → Director 승인 요청 흐름을 mock / Hermes dry-run / Hermes 모드로 실행합니다.</p>
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
            <button onClick={start} disabled={isBusy || isHermesBlocked}>{isBusy ? "실행 중..." : isHermesBlocked ? "Hermes 한도 도달" : "파이프라인 시작"}</button>
          </section>

          {runnerMode === "hermes" ? (
            <div className="content-pipeline-cost-notice">
              Hermes 실제 실행은 OpenAI API 비용이 발생할 수 있습니다. 이번 파이프라인은 최대 <b>{HERMES_PIPELINE_REQUIRED_RUNS}회</b>를 호출할 수 있고, 남은 실행 가능 횟수는 <b>{hermesUsage ? `${hermesUsage.remaining}회` : "확인 중"}</b>입니다. 비용 없는 점검은 <b>mock</b> 또는 <b>hermes-dry-run</b>을 사용하세요.
            </div>
          ) : null}

          <section className={`content-pipeline-usage-card ${hermesUsage?.blocked ? "is-blocked" : ""}`}>
            <div>
              <strong>Hermes 오늘 실행: {hermesUsage ? `${hermesUsage.used} / ${hermesUsage.limit}회` : "확인 중"}</strong>
              <span>남은 실행 가능 횟수: {hermesUsage ? `${hermesUsage.remaining}회` : "-"} · 기준: {hermesUsage?.timezone ?? "Asia/Seoul"}</span>
              <small>mock / hermes-dry-run / 실행 전 취소는 사용량에 포함되지 않습니다. Hermes 모드는 content-planner + marketing-manager + content-writer + qa-auditor 최대 4회를 사용합니다.</small>
              {hermesUsageError ? <small className="content-pipeline-error">{hermesUsageError}</small> : null}
            </div>
            <div className="content-pipeline-usage-runs">
              <span>최근 Hermes 실행</span>
              {hermesUsage?.recentRuns.length ? (
                <ul>
                  {hermesUsage.recentRuns.map((run) => {
                    const runDurationLabel = formatDurationMs(run.durationMs);
                    return (
                      <li key={run.id}>
                        <strong>{formatTime(run.createdAt)}</strong>
                        <span>{run.agentId} - {run.status}{run.provider ? ` - ${run.provider}` : ""}{runDurationLabel ? ` - ${runDurationLabel}` : ""}</span>
                        <small>{run.title ?? "Untitled"}{run.parseStatus ? ` - ${parseStatusLabel(run.parseStatus)}` : ""}</small>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <small>오늘 실제 Hermes 실행 기록이 없습니다.</small>
              )}
            </div>
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
                  <PlannerResultCard pipeline={detail?.pipeline ?? selectedPipeline} agentRuns={detail?.agentRuns ?? []} />
                  <MarketingResultCard pipeline={detail?.pipeline ?? selectedPipeline} agentRuns={detail?.agentRuns ?? []} />
                  <WriterResultCard pipeline={detail?.pipeline ?? selectedPipeline} agentRuns={detail?.agentRuns ?? []} />
                  <QaResultCard pipeline={detail?.pipeline ?? selectedPipeline} agentRuns={detail?.agentRuns ?? []} />
                  <ApprovedResultCard pipeline={detail?.pipeline ?? selectedPipeline} approval={detail?.approval ?? null} />
                  <div className="feature-card">
                    <label>관련 업무</label>
                    <ul className="audit-list">
                      {(detail?.tasks.length ? detail.tasks : selectedPipeline.taskIds.map((taskId) => ({ id: taskId, title: taskId, status: "확인 중", progress: 0, assignedEmployeeId: null, currentStep: null, recentOutput: null }))).map((task) => (
                        <li key={task.id}>{task.status} · {task.title} · {task.assignedEmployeeId ?? "미배정"} · {task.progress}%</li>
                      ))}
                    </ul>
                  </div>
                  <div className="feature-card">
                    <label>승인 요청</label>
                    {detail?.approval ? (
                      <>
                        <strong>{detail.approval.status} · {detail.approval.title}</strong>
                        <p>{detail.approval.reason}</p>
                      </>
                    ) : selectedPipeline.approvalId ? (
                      <p>approval: {selectedPipeline.approvalId}</p>
                    ) : (
                      <p>아직 승인 요청이 없습니다.</p>
                    )}
                  </div>
                  <div className="timeline feature-timeline">
                    {detailError ? <article><i className="error" /><time>DB</time><p>상세 timeline 조회 실패 · {detailError}</p></article> : null}
                    {detail?.timeline.length ? detail.timeline.map((entry) => (
                      <article key={entry.id}>
                        <i className={entry.title.includes("Approval") || entry.title.includes("승인") ? "waiting" : entry.title.includes("Output") || entry.title.includes("완료") ? "done" : "working"} />
                        <time>{formatTime(entry.timestamp)}</time>
                        <p>{entry.title} · {entry.description ?? "DB timeline 기록"}</p>
                      </article>
                    )) : (
                      <>
                        <article><i className="working" /><time>1</time><p>content-planner · 콘텐츠 기획</p></article>
                        <article><i className="working" /><time>2</time><p>marketing-manager · 제목/홍보 문구 검토</p></article>
                        <article><i className="working" /><time>3</time><p>content-writer · 게시용 본문 초안 작성</p></article>
                        <article><i className="working" /><time>4</time><p>qa-auditor · 사실성/정책/품질 검토</p></article>
                        <article><i className="waiting" /><time>5</time><p>director · 최종 승인 대기</p></article>
                      </>
                    )}
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
            <p>이번 단계에서는 content-planner, marketing-manager, content-writer, qa-auditor를 Hermes Bridge로 실행할 수 있습니다. 실제 게시 작업은 수행하지 않습니다.</p>
          </div>
        </div>
      </aside>
    </>
  );
}
