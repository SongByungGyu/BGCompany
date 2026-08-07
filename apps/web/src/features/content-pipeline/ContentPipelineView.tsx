"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { DB_SYNC_INTERVAL_MS } from "@/lib/db-sync";
import { cancelNaverDraftJob, createNaverDraftJob, fetchContentPipeline, fetchContentPipelines, fetchHermesUsage, fetchNaverDraftJobState, startContentPipeline } from "./api";
import { mockContentPipelines } from "./mock-content-pipeline";
import type {
  ContentChannel,
  ContentPipelineDetail,
  ContentPipelineRun,
  HermesUsageSummary,
  NaverBlogPublishPrep,
  NaverDraftJob,
  NaverDraftPolicy,
  StockBriefingTemplate,
  StockBriefingTemplateConfig,
} from "./content-pipeline-types";
import type { BlogImagePrompt, MarketSnapshot, MarketSnapshotMetric, ReferenceBundle, ReferenceItem } from "@/lib/stock-blog/references/reference-types";
import { summarizeContentPipelineStatus } from "@/lib/dashboard-summary/summary-rules";
import { buildStockBlogThumbnail } from "@/lib/stock-blog/thumbnail-automation";

const channelLabels: Record<ContentChannel, string> = {
  blog: "블로그",
  instagram: "인스타그램",
  youtube: "유튜브",
  newsletter: "뉴스레터",
};

const HERMES_PIPELINE_REQUIRED_RUNS = 8;

const INVESTMENT_DISCLAIMER =
  "본 글은 투자 판단을 돕기 위한 시장 정리 자료이며, 특정 종목의 매수·매도 추천이 아닙니다. 투자 결정과 책임은 투자자 본인에게 있습니다.";

const DEFAULT_NAVER_TAGS = [
  "BGMarketNote",
  "주식시장",
  "한국주식",
  "미국주식",
  "증시브리핑",
  "시장전망",
  "투자공부",
];

const STOCK_BRIEFING_TEMPLATE_CONFIGS: Record<StockBriefingTemplate, StockBriefingTemplateConfig> = {
  KOREA_DAILY_PREVIEW: {
    type: "KOREA_DAILY_PREVIEW",
    label: "평일 07:20 KST 생성 시작 · 08:20 이전 한국장 전망 발행",
    recommendedSchedule: "평일 07:20 KST 자동 생성 시작 · 08:20 이전 발행 목표",
    recommendedCategory: "오늘의 한국장 전망",
    requiredSections: ["30초 요약", "전일 한국장 코멘트와 간밤 미국장 핵심 숫자", "오늘 한국장 핵심 변수 2가지", "한국장 상승·하락 조건", "오늘의 초보자 설명", "오늘 한국장 볼 것 3가지", "BG Market Note 판단", "함께 확인한 기사"],
    defaultTags: ["BGMarketNote", "주식시장", "증시브리핑", "시장전망", "투자공부", "한국주식", "코스피", "코스닥", "국장전망", "환율", "반도체", "2차전지"],
    thumbnailTextCandidates: ["오늘의 한국장 체크", "국장 프리뷰 핵심", "금리·환율 체크"],
  },
  KOREA_MARKET_CLOSE_US_PREVIEW: {
    type: "KOREA_MARKET_CLOSE_US_PREVIEW",
    label: "평일 17:00 KST · 전일 미국장 리뷰 + 오늘 미국장 전망",
    recommendedSchedule: "평일 17:00 KST 발행",
    recommendedCategory: "오늘의 미국장 전망",
    requiredSections: ["30초 요약", "전일 미국장 핵심 숫자와 오늘 연결 신호", "오늘 밤 미국장 핵심 변수 2가지", "미국장 상승·하락 조건", "오늘의 초보자 설명", "오늘 밤 미국장 볼 것 3가지", "BG Market Note 판단", "함께 확인한 기사"],
    defaultTags: ["BGMarketNote", "주식시장", "증시브리핑", "시장전망", "투자공부", "미국주식", "나스닥", "S&P500", "다우지수", "미장전망", "빅테크", "금리"],
    thumbnailTextCandidates: ["오늘 미국장 전망", "전일 미장·오늘 밤 체크", "나스닥 핵심 변수"],
  },
  WEEKLY_MARKET_REVIEW: {
    type: "WEEKLY_MARKET_REVIEW",
    label: "토요일 09:00 KST · 이번 주 한국/미국 시장 복기",
    recommendedSchedule: "토요일 09:00 KST 발행",
    recommendedCategory: "주간 시장 정리",
    requiredSections: ["30초 요약", "이번 주 한국·미국 시장 핵심 숫자", "이번 주 핵심 변수 2가지", "이번 주 상승·하락을 가른 조건", "이번 주 수급·주도 업종", "이번 주 초보자 설명", "다음 주에 다시 볼 것 3가지", "BG Market Note 판단", "함께 확인한 기사"],
    defaultTags: ["BGMarketNote", "주식시장", "증시브리핑", "투자공부", "주간증시", "시장정리", "주간수급", "주도업종", "한국주식", "미국주식", "나스닥"],
    thumbnailTextCandidates: ["주간 시장 정리", "이번 주 증시 흐름", "섹터 흐름 한눈에"],
  },
  NEXT_WEEK_MARKET_PREVIEW: {
    type: "NEXT_WEEK_MARKET_PREVIEW",
    label: "일요일 19:00 KST · 다음 주 시장 전망",
    recommendedSchedule: "일요일 19:00 KST 발행",
    recommendedCategory: "차주 시장 전망",
    requiredSections: ["30초 요약", "지난주 시장 핵심 숫자", "다음 주 핵심 변수 2가지", "다음 주 핵심 일정", "다음 주 상승·하락 조건", "다음 주 초보자 설명", "다음 주 볼 것 3가지", "BG Market Note 판단", "함께 확인한 기사"],
    defaultTags: ["BGMarketNote", "주식시장", "증시브리핑", "시장전망", "투자공부", "다음주증시", "경제지표", "실적시즌", "금리", "섹터흐름"],
    thumbnailTextCandidates: ["다음 주 증시 일정", "다음 주 체크포인트", "경제지표 미리보기"],
  },
};

const NAVER_PUBLISH_CHECKLIST = [
  "네이버 블로그 제목 붙여넣기",
  "본문 붙여넣기",
  "태그 입력",
  "카테고리 선택",
  "썸네일 이미지 업로드",
  "투자 유의문구 확인",
  "미리보기 확인",
  "임시저장 또는 발행 직접 진행",
  "게시 URL 기록",
];

function uniqueNonEmpty(values: Array<string | undefined | null>, limit = 12) {
  const seen = new Set<string>();
  const result: string[] = [];
  values.forEach((value) => {
    const trimmed = value?.trim();
    if (!trimmed || seen.has(trimmed)) return;
    seen.add(trimmed);
    result.push(trimmed);
  });
  return result.slice(0, limit);
}


function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}


function inferStockBriefingTemplate(pipeline: ContentPipelineRun): StockBriefingTemplate {
  const source = `${pipeline.title} ${pipeline.topic} ${pipeline.writerResult?.finalTitle ?? ""}`.toLowerCase();
  if (source.includes("다음 주") || source.includes("next week") || source.includes("프리뷰")) return "NEXT_WEEK_MARKET_PREVIEW";
  if (source.includes("주간") || source.includes("금주") || source.includes("weekly")) return "WEEKLY_MARKET_REVIEW";
  if (source.includes("미국") || source.includes("us") || source.includes("나스닥")) return "KOREA_MARKET_CLOSE_US_PREVIEW";
  return "KOREA_DAILY_PREVIEW";
}

function recommendNaverCategory(template: StockBriefingTemplate) {
  return STOCK_BRIEFING_TEMPLATE_CONFIGS[template].recommendedCategory;
}

function getNaverTitle(pipeline: ContentPipelineRun) {
  return pipeline.writerResult?.finalTitle
    ?? pipeline.marketingResult?.recommendedTitle
    ?? pipeline.plannerResult?.title
    ?? pipeline.outputTitle
    ?? pipeline.title;
}


function markdownToHtml(markdown: string) {
  const blocks = markdown.split(/\n{2,}/).map((block) => block.trim()).filter(Boolean);
  return blocks.map((block) => {
    if (block.startsWith("# ")) return `<h1>${escapeHtml(block.slice(2))}</h1>`;
    if (block.startsWith("## ")) return `<h2>${escapeHtml(block.slice(3))}</h2>`;
    if (block.startsWith("### ")) return `<h3>${escapeHtml(block.slice(4))}</h3>`;
    if (block.startsWith("---")) return "<hr />";
    const lines = block.split("\n").map((line) => line.trim()).filter(Boolean);
    if (lines.length > 0 && lines.every((line) => line.startsWith("- "))) {
      return `<ul>${lines.map((line) => `<li>${escapeHtml(line.slice(2))}</li>`).join("")}</ul>`;
    }
    return `<p>${escapeHtml(block).replace(/\n/g, "<br />")}</p>`;
  }).join("\n");
}

function compactText(...values: Array<string | undefined | null>) {
  return values.map((value) => value?.trim()).find(Boolean) ?? "";
}

function listFromSources(values: Array<string[] | undefined>, fallback: string[], limit = 6) {
  return uniqueNonEmpty([...values.flatMap((items) => items ?? []), ...fallback], limit);
}

function buildStockBriefingSections(pipeline: ContentPipelineRun, title: string, template: StockBriefingTemplate) {
  const config = STOCK_BRIEFING_TEMPLATE_CONFIGS[template];
  const writer = pipeline.writerResult;
  const planner = pipeline.plannerResult;
  const marketing = pipeline.marketingResult;
  const qa = pipeline.qaResult;
  const sourceSummary = compactText(writer?.metaDescription, pipeline.outputSummary, planner?.summary, marketing?.reviewSummary, pipeline.topic);
  const writerSectionText = writer?.sections?.map((section) => [section.heading, section.body].filter(Boolean).join(" - ")).join("\n") ?? "";
  const sourceBody = compactText(writer?.fullDraft, writer?.markdownDraft, writerSectionText, planner?.content, planner?.draftDirection, sourceSummary);

  const intro = compactText(
    writer?.introduction,
    marketing?.introHook,
    `${title}을 중심으로 오늘 확인할 시장 변수와 투자자가 점검할 포인트를 정리합니다.`,
  );
  const marketSummary = compactText(
    sourceSummary,
    `${config.requiredSections[0]}을 기준으로 시장 분위기를 과장 없이 요약합니다. 현재 단계에서는 실시간 시세 API가 연결되어 있지 않아 구체 수치는 수동 확인이 필요합니다.`,
  );
  const indexAndSectorFlow = compactText(
    planner?.outline?.slice(0, 3).join(" · "),
    `${config.requiredSections.includes("코스피·코스닥 흐름") || config.requiredSections.includes("코스피·코스닥 예상 흐름") ? "코스피·코스닥" : "주요 지수"}와 섹터 흐름은 실제 지수/수급 데이터를 확인한 뒤 보강합니다. 반도체, 2차전지, 빅테크, 금리 민감 업종처럼 시장 영향도가 큰 축을 우선 점검합니다.`,
  );
  const keyPoints = listFromSources(
    [marketing?.clickPoints, marketing?.improvementSuggestions, planner?.outline, qa?.qualityNotes],
    config.requiredSections.slice(0, 5),
    7,
  );
  const investorChecklist = listFromSources(
    [qa?.riskNotes, marketing?.riskNotes],
    ["실제 지수와 환율 기준 시점 확인", "금리·유가·달러 흐름 확인", "강세 섹터의 지속 가능성 점검", "단기 급등 종목 추격 매수 주의", "손절/분할 매수 기준 사전 점검"],
    6,
  );
  const closingComment = compactText(
    writer?.conclusion,
    writer?.cta,
    "오늘의 시장 흐름은 단일 변수보다 금리, 환율, 수급, 섹터 모멘텀을 함께 확인하는 방식으로 접근하는 편이 안전합니다.",
  );

  return { intro, marketSummary, indexAndSectorFlow: sourceBody.length > 80 ? indexAndSectorFlow : `${indexAndSectorFlow}

참고 초안: ${sourceBody}`, keyPoints, investorChecklist, closingComment };
}

function buildPasteReadyBody(title: string, prep: Pick<NaverBlogPublishPrep, "intro" | "marketSummary" | "indexAndSectorFlow" | "keyPoints" | "investorChecklist" | "closingComment" | "disclaimer">) {
  return [
    title,
    "",
    "[도입부]",
    prep.intro,
    "",
    "[시장 요약]",
    prep.marketSummary,
    "",
    "[주요 지수/섹터 흐름]",
    prep.indexAndSectorFlow,
    "",
    "[주목 포인트]",
    ...prep.keyPoints.map((item) => `- ${item}`),
    "",
    "[투자자 체크리스트]",
    ...prep.investorChecklist.map((item) => `- ${item}`),
    "",
    "[마무리]",
    prep.closingComment,
    "",
    "[투자 유의문구]",
    prep.disclaimer,
  ].join("\n");
}

function buildStructuredMarkdown(title: string, prep: Pick<NaverBlogPublishPrep, "intro" | "marketSummary" | "indexAndSectorFlow" | "keyPoints" | "investorChecklist" | "closingComment" | "disclaimer">) {
  return [
    `# ${title}`,
    "",
    "## 도입부",
    prep.intro,
    "",
    "## 시장 요약",
    prep.marketSummary,
    "",
    "## 주요 지수/섹터 흐름",
    prep.indexAndSectorFlow,
    "",
    "## 주목 포인트",
    ...prep.keyPoints.map((item) => `- ${item}`),
    "",
    "## 투자자 체크리스트",
    ...prep.investorChecklist.map((item) => `- ${item}`),
    "",
    "## 마무리",
    prep.closingComment,
    "",
    "---",
    prep.disclaimer,
  ].join("\n");
}

function buildInlineImageIdeas(template: StockBriefingTemplate): NaverBlogPublishPrep["inlineImageIdeas"] {
  const market = template === "KOREA_MARKET_CLOSE_US_PREVIEW" ? "미국장" : "한국장";
  return [
    {
      position: "본문 상단",
      description: `${market} 핵심 체크포인트 요약 카드`,
      prompt: "cream background, clean Korean stock market briefing card, 3 bullet placeholders, no logos, no real index numbers",
    },
    {
      position: "본문 중간",
      description: "섹터별 흐름을 한눈에 보는 미니 차트",
      prompt: "minimal sector flow infographic, soft blue and green, abstract bars and arrows, no company logos, no investment promise",
    },
    {
      position: "본문 하단",
      description: "투자 유의사항과 다음 체크리스트 이미지",
      prompt: "calm checklist illustration for investment caution, notebook, magnifier, neutral tone, no financial advice wording",
    },
  ];
}

function buildNaverBlogPublishPrep(pipeline: ContentPipelineRun): NaverBlogPublishPrep {
  const template = inferStockBriefingTemplate(pipeline);
  const config = STOCK_BRIEFING_TEMPLATE_CONFIGS[template];
  const naverTitle = getNaverTitle(pipeline);
  const structuredSections = buildStockBriefingSections(pipeline, naverTitle, template);
  const draftPrep = { ...structuredSections, disclaimer: INVESTMENT_DISCLAIMER };
  const pasteReadyBody = buildPasteReadyBody(naverTitle, draftPrep);
  const markdownBody = buildStructuredMarkdown(naverTitle, draftPrep);
  const referenceBundle = pipeline.naverBlogPublishPrep?.referenceBundle
    ?? pipeline.referenceBundle
    ?? pipeline.writerResult?.referenceBundle
    ?? pipeline.qaResult?.referenceBundle
    ?? pipeline.marketingResult?.referenceBundle;
  const blogImagePrompts = pipeline.naverBlogPublishPrep?.blogImagePrompts
    ?? pipeline.blogImagePrompts
    ?? pipeline.writerResult?.blogImagePrompts
    ?? pipeline.qaResult?.blogImagePrompts
    ?? pipeline.marketingResult?.blogImagePrompts
    ?? [];
  const tags = uniqueNonEmpty([
    ...(pipeline.writerResult?.usedSeoKeywords ?? []),
    ...(pipeline.marketingResult?.seoKeywords ?? []),
    ...(pipeline.plannerResult?.seoKeywords ?? []),
    ...(referenceBundle?.repeatedKeywords ?? []),
    ...config.defaultTags,
    ...DEFAULT_NAVER_TAGS,
  ], 12);
  const thumbnail = pipeline.thumbnailResult ?? buildStockBlogThumbnail(pipeline, template);

  return {
    naverTitle,
    naverCategory: recommendNaverCategory(template),
    naverTags: tags,
    thumbnailText: thumbnail.thumbnailPrimaryText,
    ...thumbnail,
    thumbnailImageUrl: pipeline.thumbnailImageUrl ?? thumbnail.thumbnailImageUrl,
    inlineImageUrls: pipeline.inlineImageUrls ?? [],
    imageStatus: pipeline.imageStatus,
    imageGeneratedAt: pipeline.imageGeneratedAt,
    imageErrorMessage: pipeline.imageErrorMessage,
    inlineImageIdeas: buildInlineImageIdeas(template),
    ...structuredSections,
    pasteReadyBody,
    markdownBody,
    htmlBody: markdownToHtml(markdownBody),
    disclaimer: INVESTMENT_DISCLAIMER,
    checklist: NAVER_PUBLISH_CHECKLIST.map((label) => ({ label, checked: false })),
    publishStatus: "ready_to_copy",
    briefingTemplate: template,
    briefingTemplateLabel: config.label,
    recommendedSchedule: config.recommendedSchedule,
    referenceBundle,
    blogImagePrompts,
  };
}


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

function sourceTypeLabel(type: ReferenceItem["sourceType"]) {
  const labels: Record<ReferenceItem["sourceType"], string> = {
    news: "뉴스",
    blog: "블로그",
    disclosure: "공시",
    market_data: "시장 데이터",
    calendar: "일정",
    sector: "섹터",
    company: "기업",
    macro: "매크로",
    manual: "수동 참고",
    mock: "mock",
  };
  return labels[type] ?? type;
}

function formatSnapshotMetric(metric?: MarketSnapshotMetric) {
  if (!metric || metric.value === undefined) return "데이터 없음";
  const value = typeof metric.value === "number"
    ? new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 3 }).format(metric.value)
    : metric.value;
  const change = typeof metric.changePct === "number"
    ? ` (${metric.changePct > 0 ? "+" : ""}${metric.changePct.toFixed(2)}%)`
    : "";
  return `${value}${change}`;
}

function snapshotProviderStatus(snapshot: MarketSnapshot, provider: "kis" | "fred") {
  if (snapshot.sources?.some((source) => source.provider === provider)) return "수집됨";
  const credential = provider === "kis" ? "KIS_" : "FRED_";
  if (snapshot.missingItems.some((item) => item.includes(credential) || item.toLowerCase().includes(provider))) return "자격증명 필요";
  return snapshot.status === "error" ? "오류" : "데이터 없음";
}

function MarketSnapshotPanel({ snapshot }: { snapshot: MarketSnapshot }) {
  const hermesEligible = snapshot.status === "ready"
    && snapshot.dataQuality === "verified"
    && snapshot.freshness?.status === "fresh"
    && snapshot.missingItems.length === 0
    && !snapshot.fallbackUsed;
  const metrics: Array<[string, MarketSnapshotMetric | undefined]> = [
    ["KOSPI", snapshot.korea?.kospi],
    ["KOSDAQ", snapshot.korea?.kosdaq],
    ["S&P 500", snapshot.us?.sp500],
    ["NASDAQ", snapshot.us?.nasdaq],
    ["Dow Jones", snapshot.us?.dow],
    ["USD/KRW", snapshot.us?.fx],
    ["미국 2년물", snapshot.macro?.us2Year],
    ["미국 10년물", snapshot.macro?.us10Year],
    ["10Y-2Y 금리차", snapshot.macro?.yieldSpread10Y2Y],
  ];

  return (
    <div className="market-snapshot-panel">
      <div className="market-snapshot-heading">
        <div>
          <label>Automatic MarketSnapshot</label>
          <strong>{snapshot.provider} · {snapshot.status} · {snapshot.dataQuality}</strong>
          <small>기준일 {snapshot.marketDate} · 수집 {formatTime(snapshot.collectedAt)}</small>
        </div>
        <span className={hermesEligible ? "eligible" : "blocked"}>
          {hermesEligible ? "Hermes 실행 가능" : "Hermes 실행 차단"}
        </span>
      </div>

      <div className="market-snapshot-meta">
        <span>KIS: {snapshotProviderStatus(snapshot, "kis")}</span>
        <span>FRED: {snapshotProviderStatus(snapshot, "fred")}</span>
        <span>freshness: {snapshot.freshness?.status ?? "unknown"}</span>
        <span>fallback: {snapshot.fallbackUsed ? "사용" : "미사용"}</span>
      </div>

      <div className="market-snapshot-metrics">
        {metrics.map(([label, metric]) => (
          <article key={label}>
            <span>{label}</span>
            <strong>{formatSnapshotMetric(metric)}</strong>
            <small>{metric?.asOf ? `기준 ${formatTime(metric.asOf)}` : "기준 시각 없음"} · {metric?.freshness ?? "unknown"}</small>
          </article>
        ))}
      </div>

      <div className="market-snapshot-columns">
        <div>
          <label>투자자별 매매동향</label>
          <ul className="content-pipeline-outline">
            {(snapshot.korea?.investorFlows ?? []).map((metric) => (
              <li key={`${metric.label}-${metric.asOf ?? "unknown"}`}>{metric.label}: {formatSnapshotMetric(metric)}</li>
            ))}
            {!snapshot.korea?.investorFlows?.length ? <li>데이터 없음</li> : null}
          </ul>
        </div>
        <div>
          <label>국내 강세 / 약세 업종</label>
          <p><strong>강세</strong> {(snapshot.korea?.strongSectors ?? []).join(" · ") || "데이터 없음"}</p>
          <p><strong>약세</strong> {(snapshot.korea?.weakSectors ?? []).join(" · ") || "데이터 없음"}</p>
        </div>
      </div>

      <div className="market-snapshot-columns">
        <div>
          <label>향후 경제지표 일정</label>
          <ul className="content-pipeline-outline">
            {(snapshot.upcoming ?? []).slice(0, 8).map((event) => (
              <li key={`${event.date}-${event.event}`}>{event.date} · {event.event}</li>
            ))}
            {!snapshot.upcoming?.length ? <li>데이터 없음</li> : null}
          </ul>
        </div>
        <div>
          <label>데이터 품질</label>
          <p>오래된 항목: {snapshot.freshness?.staleItems.join(" · ") || "없음"}</p>
          <p>누락 항목: {snapshot.missingItems.join(" · ") || "없음"}</p>
        </div>
      </div>

      {snapshot.sources?.length ? (
        <details className="content-pipeline-payload">
          <summary>출처 · 기준 시각 · freshness 보기</summary>
          <div className="market-snapshot-sources">
            {snapshot.sources.map((source, index) => (
              <a key={`${source.provider}-${source.url}-${index}`} href={source.url} target="_blank" rel="noreferrer">
                {source.sourceName} · 기준 {formatTime(source.asOf)} · 수집 {formatTime(source.collectedAt)} · {source.freshness}
              </a>
            ))}
          </div>
        </details>
      ) : null}
    </div>
  );
}

function formatReferenceBundleForCopy(bundle?: ReferenceBundle) {
  if (!bundle) return "";
  const lines = [
    `[참고자료 정책] ${bundle.sourcePolicy}`,
    bundle.queries.length ? `검색 쿼리: ${bundle.queries.join(" / ")}` : "",
    bundle.keyThemes.length ? `핵심 테마: ${bundle.keyThemes.join(", ")}` : "",
    bundle.repeatedKeywords.length ? `반복 키워드: ${bundle.repeatedKeywords.join(", ")}` : "",
    bundle.differentiationPoints.length ? `차별화 포인트: ${bundle.differentiationPoints.join(" / ")}` : "",
    bundle.cautionNotes.length ? `주의사항: ${bundle.cautionNotes.join(" / ")}` : "",
    "",
    ...bundle.items.map((item, index) => [
      `${index + 1}. ${item.title}`,
      `- 출처: ${item.publisher ?? item.provider} · ${sourceTypeLabel(item.sourceType)}`,
      item.publishedAt ? `- 발행일: ${item.publishedAt}` : "",
      item.summary ? `- 요약: ${item.summary}` : "",
      item.url ? `- URL: ${item.url}` : "",
      item.usageNote ? `- 활용: ${item.usageNote}` : "",
    ].filter(Boolean).join("\n")),
  ].filter(Boolean);
  return lines.join("\n");
}

function formatReferenceLinksForCopy(bundle?: ReferenceBundle) {
  if (!bundle) return "";
  return bundle.items
    .map((item, index) => `${index + 1}. ${item.title}${item.url ? `\n${item.url}` : ""}`)
    .join("\n\n");
}

function formatBlogImagePromptsForCopy(prompts?: BlogImagePrompt[]) {
  if (!prompts?.length) return "";
  return prompts.map((prompt, index) => [
    `${index + 1}. ${prompt.title}`,
    `- 용도: ${prompt.purpose} / ${prompt.placement}`,
    prompt.textOverlay ? `- 문구: ${prompt.textOverlay}` : "",
    `- 프롬프트: ${prompt.prompt}`,
    `- 제외: ${prompt.negativePrompt}`,
    `- 비율: ${prompt.aspectRatio ?? "권장 없음"}`,
    `- 메모: ${prompt.notes}`,
  ].filter(Boolean).join("\n")).join("\n\n");
}

function NaverBlogPublishPrepPanel({ pipeline }: { pipeline: ContentPipelineRun }) {
  const isApproved = pipeline.status === "approved" || pipeline.status === "published_ready" || pipeline.status === "completed";
  const hasWriterPreview = Boolean(pipeline.writerResult?.ok);
  const [thumbnailRefreshCount, setThumbnailRefreshCount] = useState(0);
  const prep = useMemo(() => {
    void thumbnailRefreshCount;
    const base = pipeline.naverBlogPublishPrep ?? buildNaverBlogPublishPrep(pipeline);
    const thumbnail = pipeline.thumbnailResult ?? buildStockBlogThumbnail(pipeline, base.briefingTemplate);
    return {
      ...base,
      ...thumbnail,
      thumbnailImageUrl: pipeline.thumbnailImageUrl ?? base.thumbnailImageUrl ?? thumbnail.thumbnailImageUrl,
      inlineImageUrls: pipeline.inlineImageUrls ?? base.inlineImageUrls ?? [],
      imageStatus: pipeline.imageStatus ?? base.imageStatus,
      imageGeneratedAt: pipeline.imageGeneratedAt ?? base.imageGeneratedAt,
      imageErrorMessage: pipeline.imageErrorMessage ?? base.imageErrorMessage,
    };
  }, [pipeline, thumbnailRefreshCount]);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [copyError, setCopyError] = useState<string | null>(null);
  const [checklistState, setChecklistState] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(prep.checklist.map((item) => [item.label, item.checked])),
  );
  const [externalUrl, setExternalUrl] = useState(prep.externalUrl ?? "");
  const [publishStatus, setPublishStatus] = useState<NaverBlogPublishPrep["publishStatus"]>(prep.publishStatus);

  if (!isApproved && !hasWriterPreview) return null;

  const copyToClipboard = async (key: string, value: string) => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
      } else {
        const textArea = document.createElement("textarea");
        textArea.value = value;
        textArea.style.position = "fixed";
        textArea.style.opacity = "0";
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        document.execCommand("copy");
        document.body.removeChild(textArea);
      }
      setCopiedKey(key);
      setCopyError(null);
      setPublishStatus("copied");
      window.setTimeout(() => setCopiedKey(null), 1600);
    } catch {
      setCopyError("브라우저 클립보드 권한이 없어 복사하지 못했습니다. 내용을 직접 선택해서 복사해주세요.");
    }
  };

  const copyButtons = [
    ["title", "제목 복사", prep.naverTitle],
    ["body", "본문 복사", prep.pasteReadyBody],
    ["markdown", "Markdown 복사", prep.markdownBody],
    ["html", "HTML 복사", prep.htmlBody],
    ["tags", "태그 복사", prep.naverTags.map((tag) => `#${tag}`).join(" ")],
    ["thumbnail", "썸네일 문구 복사", prep.thumbnailText],
    ["imagePrompt", "이미지 프롬프트 복사", [prep.thumbnailPrompt, ...prep.inlineImageIdeas.map((idea) => `${idea.position}: ${idea.prompt}`)].join("\n\n")],
    ["referenceBundle", "참고자료 요약 복사", formatReferenceBundleForCopy(prep.referenceBundle)],
    ["referenceLinks", "출처 링크 복사", formatReferenceLinksForCopy(prep.referenceBundle)],
    ["blogImagePrompts", "이미지 프롬프트 전체 복사", formatBlogImagePromptsForCopy(prep.blogImagePrompts)],
    ["disclaimer", "투자 유의문구 복사", prep.disclaimer],
  ].filter(([, , value]) => value.trim().length > 0);

  const regenerateThumbnail = () => {
    setThumbnailRefreshCount((count) => count + 1);
    setCopiedKey("thumbnailRegenerated");
    window.setTimeout(() => setCopiedKey(null), 1600);
  };

  return (
    <div className="feature-card naver-publish-prep">
      <div className="naver-prep-head">
        <div>
          <label>네이버 블로그 게시 준비</label>
          <strong>{prep.naverTitle}</strong>
          <p>{isApproved ? "승인 완료된 결과물을 네이버 블로그 수동 업로드용으로 정리했습니다." : "작성 초안 기준 미리보기입니다. 최종 게시 전 Director 승인을 확인하세요."}</p>
        </div>
        <span>{publishStatus === "manually_published" ? "게시 URL 기록" : publishStatus === "copied" ? "복사 준비됨" : "복붙 준비"}</span>
      </div>

      <div className="naver-prep-warning">
        <strong>자동 게시 없음</strong>
        <p>네이버 로그인, 쿠키 우회, 자동 업로드는 하지 않습니다. 아래 내용을 복사해 네이버 블로그에 직접 붙여넣어 주세요.</p>
      </div>

      <div className="naver-prep-grid">
        <div className="naver-prep-block">
          <label>카테고리 추천</label>
          <strong>{prep.naverCategory}</strong>
          {prep.briefingTemplateLabel ? <small>{prep.briefingTemplateLabel}</small> : null}
          {prep.recommendedSchedule ? <small>{prep.recommendedSchedule}</small> : null}
        </div>
        <div className="naver-prep-block">
          <label>태그</label>
          <div className="content-pipeline-keywords">{prep.naverTags.map((tag) => <span key={tag}>#{tag}</span>)}</div>
        </div>
      </div>

      <div className="naver-copy-actions">
        {copyButtons.map(([key, label, value]) => (
          <button key={key} type="button" onClick={() => copyToClipboard(key, value)}>
            {copiedKey === key ? "복사 완료" : label}
          </button>
        ))}
      </div>
      {copyError ? <p className="content-pipeline-error">{copyError}</p> : null}

      <div className="naver-prep-block">
        <label>도입부</label>
        <p>{prep.intro}</p>
      </div>

      <div className="naver-prep-grid">
        <div className="naver-prep-block">
          <label>시장 요약</label>
          <p>{prep.marketSummary}</p>
        </div>
        <div className="naver-prep-block">
          <label>주요 지수/섹터 흐름</label>
          <p>{prep.indexAndSectorFlow}</p>
        </div>
      </div>

      <div className="naver-prep-grid">
        <div className="naver-prep-block">
          <label>주목 포인트</label>
          <ul className="content-pipeline-outline">
            {prep.keyPoints.map((item) => <li key={item}>{item}</li>)}
          </ul>
        </div>
        <div className="naver-prep-block">
          <label>투자자 체크리스트</label>
          <ul className="content-pipeline-outline">
            {prep.investorChecklist.map((item) => <li key={item}>{item}</li>)}
          </ul>
        </div>
      </div>

      <div className="naver-prep-block">
        <label>마무리</label>
        <p>{prep.closingComment}</p>
      </div>

      <div className="naver-prep-block">
        <label>네이버 블로그 붙여넣기용 최종본</label>
        <pre className="content-pipeline-draft">{prep.pasteReadyBody}</pre>
      </div>

      <details className="content-pipeline-payload" open>
        <summary>Markdown / HTML 초안 보기</summary>
        <div className="naver-prep-split">
          <div>
            <label>Markdown</label>
            <pre>{prep.markdownBody}</pre>
          </div>
          <div>
            <label>HTML</label>
            <pre>{prep.htmlBody}</pre>
          </div>
        </div>
      </details>

      <div className="naver-prep-grid">
        <div className="naver-prep-block naver-thumbnail-panel">
          <div className="naver-thumbnail-head">
            <label>썸네일 자동화</label>
            <span>{prep.thumbnailStatus === "copy_ready" ? "문구 준비 완료" : prep.thumbnailStatus}</span>
          </div>
          <div className="naver-thumbnail-preview">
            <small>{prep.thumbnailTemplateType}</small>
            <strong>{prep.thumbnailPrimaryText}</strong>
            <p>{prep.thumbnailSecondaryText}</p>
            <em>{prep.thumbnailHook}</em>
          </div>
          <div className="content-pipeline-keywords">
            {prep.thumbnailKeywords.map((keyword) => <span key={keyword}>#{keyword}</span>)}
          </div>
          <p className="naver-thumbnail-style">{prep.thumbnailStyle}</p>
          {prep.thumbnailImageUrl ? <a href={prep.thumbnailImageUrl} target="_blank" rel="noreferrer">썸네일 이미지 열기</a> : <small>실제 이미지 생성은 아직 실행하지 않았습니다. 프롬프트를 복사해 수동 생성할 수 있습니다.</small>}
          {prep.thumbnailErrorMessage ? <p className="content-pipeline-error">{prep.thumbnailErrorMessage}</p> : null}
          <button type="button" className="secondary-action" onClick={regenerateThumbnail}>
            {copiedKey === "thumbnailRegenerated" ? "재생성 완료" : "현재 콘텐츠 기준 재생성"}
          </button>
          <details className="content-pipeline-payload">
            <summary>썸네일 프롬프트 / 변형안 보기</summary>
            <pre>{prep.thumbnailPrompt}</pre>
            <div className="thumbnail-variant-list">
              {prep.thumbnailVariants.map((variant) => (
                <div key={variant.id} className="thumbnail-variant-card">
                  <strong>{variant.label} · {variant.thumbnailTitle}</strong>
                  <p>{variant.thumbnailSubtitle} · {variant.thumbnailHook}</p>
                  <button type="button" onClick={() => copyToClipboard(`thumbnailVariant-${variant.id}`, variant.thumbnailPrompt)}>
                    {copiedKey === `thumbnailVariant-${variant.id}` ? "복사 완료" : "변형 프롬프트 복사"}
                  </button>
                </div>
              ))}
            </div>
          </details>
        </div>
        <div className="naver-prep-block">
          <label>투자 유의 문구</label>
          <p>{prep.disclaimer}</p>
        </div>
      </div>

      <div className="naver-prep-block">
        <label>본문 이미지 아이디어</label>
        <ul className="content-pipeline-outline">
          {prep.inlineImageIdeas.map((idea) => (
            <li key={`${idea.position}-${idea.description}`}>
              <strong>{idea.position}</strong> · {idea.description}
              <p>{idea.prompt}</p>
            </li>
          ))}
        </ul>
        {prep.inlineImageUrls?.length ? (
          <div className="stock-image-prompt-list">
            {prep.inlineImageUrls.map((url, index) => (
              <article key={url} className="stock-image-prompt-item">
                <span>자체 생성 본문 이미지 {index + 1}</span>
                <a href={url} target="_blank" rel="noreferrer">이미지 열기</a>
              </article>
            ))}
          </div>
        ) : null}
        <small>이미지 상태: {prep.imageStatus ?? "미생성"}{prep.imageGeneratedAt ? ` · ${new Date(prep.imageGeneratedAt).toLocaleString("ko-KR")}` : ""}</small>
        {prep.imageErrorMessage ? <p className="content-pipeline-error">{prep.imageErrorMessage}</p> : null}
      </div>

      {prep.referenceBundle ? (
        <div className="naver-prep-block stock-reference-panel">
          <label>관련 기사 / 참고자료</label>
          {pipeline.qualityGate ? (
            <div className={pipeline.qualityGate.ok ? "stock-reference-quality passed" : "stock-reference-quality blocked"}>
              <strong>{pipeline.qualityGate.ok ? "품질 게이트 통과" : "품질 게이트 차단"}</strong>
              <p>{pipeline.qualityGate.reasons.length ? pipeline.qualityGate.reasons.join(" · ") : "참고자료와 최종 본문 기준을 충족했습니다."}</p>
              <small>
                실제 참고자료 {String(pipeline.qualityGate.diagnostics.realReferenceCount ?? 0)}개 · URL {String(pipeline.qualityGate.diagnostics.distinctUrlCount ?? 0)}개 · 발행처 {String(pipeline.qualityGate.diagnostics.publisherCount ?? 0)}곳
                {pipeline.qualityGate.diagnostics.editorialQualityScore !== undefined
                  ? ` · 편집 품질 ${String(pipeline.qualityGate.diagnostics.editorialQualityScore)}/${String(pipeline.qualityGate.diagnostics.editorialQualityTarget ?? 95)}`
                  : ""}
              </small>
            </div>
          ) : null}
          {pipeline.editorialBenchmark ? (
            <div className={pipeline.editorialBenchmark.quality.passed ? "stock-reference-quality passed" : "stock-reference-quality blocked"}>
              <strong>자사·경쟁 블로그 구조 비교</strong>
              <p>
                자사 본문 {pipeline.editorialBenchmark.own.bodyLength.toLocaleString("ko-KR")}자 · 소제목 {pipeline.editorialBenchmark.own.headingCount}개 · 이미지 {pipeline.editorialBenchmark.own.imageCount}장
                {pipeline.editorialBenchmark.competitor.analyzedCount > 0
                  ? ` / 경쟁군 평균 ${pipeline.editorialBenchmark.competitor.averages.bodyLength.toLocaleString("ko-KR")}자 · 소제목 ${pipeline.editorialBenchmark.competitor.averages.headingCount}개 · 이미지 ${pipeline.editorialBenchmark.competitor.averages.imageCount}장`
                  : " / 경쟁군 심층 표본 대기"}
              </p>
              <small>
                비교 표본 {pipeline.editorialBenchmark.competitor.analyzedCount}개
                {pipeline.editorialBenchmark.improvementCandidates.length
                  ? ` · 개선 후보: ${pipeline.editorialBenchmark.improvementCandidates.slice(0, 3).join(" · ")}`
                  : " · 추가 개선 필요 없음"}
              </small>
            </div>
          ) : null}
          {prep.referenceBundle.missingItems?.length ? (
            <div className="naver-prep-warning subtle">
              <strong>부족한 참고자료</strong>
              <p>{prep.referenceBundle.missingItems.join(" · ")}</p>
            </div>
          ) : null}
          <div className="stock-reference-meta">
            <span>{prep.referenceBundle.provider}</span>
            <span>{prep.referenceBundle.mode}</span>
            <span>{prep.referenceBundle.status ?? "상태 미정"}</span>
            <span>{prep.referenceBundle.market}</span>
          </div>
          <p>{prep.referenceBundle.sourcePolicy}</p>
          {prep.referenceBundle.marketSnapshot ? <MarketSnapshotPanel snapshot={prep.referenceBundle.marketSnapshot} /> : null}
          {prep.referenceBundle.queries.length ? (
            <div className="content-pipeline-keywords">
              {prep.referenceBundle.queries.map((query) => <span key={query}>{query}</span>)}
            </div>
          ) : null}
          <div className="naver-prep-grid">
            <div className="naver-prep-block compact">
              <label>핵심 테마</label>
              <ul className="content-pipeline-outline">{prep.referenceBundle.keyThemes.map((item) => <li key={item}>{item}</li>)}</ul>
            </div>
            <div className="naver-prep-block compact">
              <label>차별화 포인트</label>
              <ul className="content-pipeline-outline">{prep.referenceBundle.differentiationPoints.map((item) => <li key={item}>{item}</li>)}</ul>
            </div>
          </div>
          {prep.referenceBundle.cautionNotes.length ? (
            <div className="naver-prep-warning subtle">
              <strong>참고자료 사용 주의</strong>
              <p>{prep.referenceBundle.cautionNotes.join(" · ")}</p>
            </div>
          ) : null}
          <div className="stock-reference-list">
            {prep.referenceBundle.items.map((item) => (
              <article key={item.id} className="stock-reference-item">
                <div>
                  <span>{sourceTypeLabel(item.sourceType)} · {item.publisher ?? item.provider}{item.reliability ? ` · ${item.reliability}` : ""}</span>
                  <strong>{item.title}</strong>
                  {item.summary ? <p>{item.summary}</p> : null}
                  {item.usageNote ? <small>{item.usageNote}</small> : null}
                </div>
                {item.url ? <a href={item.url} target="_blank" rel="noreferrer">원문</a> : null}
              </article>
            ))}
          </div>
        </div>
      ) : null}

      {prep.blogImagePrompts?.length ? (
        <div className="naver-prep-block stock-image-prompt-panel">
          <label>이미지 프롬프트 준비</label>
          <div className="stock-image-prompt-list">
            {prep.blogImagePrompts.map((prompt) => (
              <article key={prompt.id} className="stock-image-prompt-item">
                <span>{prompt.purpose} · {prompt.placement} · {prompt.aspectRatio ?? "비율 자유"}</span>
                <strong>{prompt.title}</strong>
                {prompt.textOverlay ? <small>문구: {prompt.textOverlay}</small> : null}
                <p>{prompt.prompt}</p>
                <em>제외: {prompt.negativePrompt}</em>
                <small>{prompt.notes}</small>
              </article>
            ))}
          </div>
        </div>
      ) : null}

      <div className="naver-prep-checklist">
        <label>수동 게시 체크리스트</label>
        {prep.checklist.map((item) => (
          <button
            key={item.label}
            type="button"
            className={checklistState[item.label] ? "checked" : ""}
            onClick={() => setChecklistState((current) => ({ ...current, [item.label]: !current[item.label] }))}
          >
            <i />{item.label}
          </button>
        ))}
      </div>

      <div className="naver-url-row">
        <input value={externalUrl} onChange={(event) => setExternalUrl(event.target.value)} placeholder="게시 후 네이버 블로그 URL을 기록하세요." />
        <button type="button" onClick={() => setPublishStatus("manually_published")} disabled={!externalUrl.trim()}>게시 URL 저장</button>
      </div>
      <small>게시 URL은 이번 단계에서 화면 상태로만 기록됩니다. DB 저장은 다음 단계에서 추가할 수 있습니다.</small>
    </div>
  );
}


function naverDraftStatusLabel(status: string) {
  const labels: Record<string, string> = {
    queued: "대기 중",
    claimed: "에이전트 할당",
    in_progress: "작성 중",
    draft_saved: "임시저장 완료",
    user_publish_required: "사용자 확인 필요",
    completed: "완료",
    failed: "실패",
    cancelled: "취소됨",
  };
  return labels[status] ?? status;
}

function NaverDraftJobPanel({
  pipeline,
  jobs,
  isLoading,
  error,
  isBusy,
  onCreate,
  onCancel,
  policy,
}: {
  pipeline: ContentPipelineRun;
  jobs: NaverDraftJob[];
  policy: NaverDraftPolicy;
  isLoading: boolean;
  error: string | null;
  isBusy: boolean;
  onCreate: () => void;
  onCancel: (jobId: string) => void;
}) {
  const isApproved = pipeline.status === "approved" || pipeline.status === "published_ready" || pipeline.status === "completed";
  const canCreateDraftJob = !policy.requireApproval || isApproved;
  const latestJob = jobs[0];
  const canCancel = latestJob && ["queued", "claimed", "in_progress"].includes(latestJob.status);

  return (
    <div className="feature-card naver-draft-job-panel">
      <div className="naver-prep-head">
        <div>
          <label>네이버 임시저장 작업</label>
          <strong>{latestJob ? naverDraftStatusLabel(latestJob.status) : "작업 없음"}</strong>
          <p>{policy.requireApproval ? "승인 완료 콘텐츠를" : "승인 여부와 무관하게 준비된 콘텐츠를"} 로컬 PC의 Naver Draft Agent가 가져가 네이버 블로그 작성 화면에 입력할 수 있도록 큐에 넣습니다.</p>
        </div>
        <span>{isLoading ? "조회 중" : `${jobs.length}개`}</span>
      </div>

      <div className="naver-prep-warning">
        <strong>수동 게시 원칙</strong>
        <p>이 작업은 네이버 로그인 정보나 쿠키를 서버에 저장하지 않습니다. 로컬 에이전트가 임시저장까지만 처리하며, 발행 버튼은 누르지 않습니다.</p>
      </div>

      <div className="naver-draft-actions">
        <button type="button" onClick={onCreate} disabled={isBusy || !canCreateDraftJob}>
          {isBusy ? "처리 중..." : latestJob ? "임시저장 작업 다시 확인/생성" : "임시저장 작업 생성"}
        </button>
        {canCancel ? <button type="button" className="secondary" onClick={() => onCancel(latestJob.id)} disabled={isBusy}>작업 취소</button> : null}
      </div>
      {policy.requireApproval && !isApproved ? <small>Director 승인 완료 후 작업 생성이 가능합니다.</small> : null}
      {!policy.requireApproval ? <small>승인 없이도 임시저장 작업을 생성할 수 있습니다. 발행은 사용자가 직접 진행합니다.{policy.autoAfterQa ? " 파이프라인 완료 후 자동 큐 생성이 켜져 있습니다." : ""}</small> : null}
      {error ? <p className="content-pipeline-error">{error}</p> : null}

      {latestJob ? (
        <div className="naver-draft-job-card">
          <div><label>Job ID</label><code>{latestJob.id}</code></div>
          <div><label>상태</label><strong>{naverDraftStatusLabel(latestJob.status)}</strong></div>
          <div><label>제목</label><p>{latestJob.title}</p></div>
          <div><label>카테고리</label><p>{latestJob.category ?? "-"}</p></div>
          <div><label>태그</label><p>{latestJob.tags.map((tag) => `#${tag}`).join(" ") || "-"}</p></div>
          <div><label>생성</label><p>{formatTime(latestJob.createdAt)}</p></div>
          {latestJob.claimedAt ? <div><label>할당</label><p>{latestJob.claimedBy ?? "local-agent"} · {formatTime(latestJob.claimedAt)}</p></div> : null}
          {latestJob.completedAt ? <div><label>완료</label><p>{formatTime(latestJob.completedAt)}</p></div> : null}
          {latestJob.externalUrl ? <div><label>외부 URL</label><a href={latestJob.externalUrl} target="_blank" rel="noreferrer">{latestJob.externalUrl}</a></div> : null}
          {latestJob.errorMessage ? <p className="content-pipeline-error">{latestJob.errorCode ?? "NAVER_DRAFT_ERROR"} · {latestJob.errorMessage}</p> : null}
        </div>
      ) : (
        <p>아직 생성된 네이버 임시저장 작업이 없습니다.</p>
      )}
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
  const [topic, setTopic] = useState("금일 한국 주식시장 흐름과 내일 체크포인트");
  const [title, setTitle] = useState("26/07/09 오늘의 한국 증시 정리와 내일 전망");
  const [channel, setChannel] = useState<ContentChannel>("blog");
  const [runnerMode, setRunnerMode] = useState<"mock" | "hermes-dry-run" | "hermes">("hermes");
  const [pipelines, setPipelines] = useState<ContentPipelineRun[]>(mockContentPipelines);
  const [selectedPipelineId, setSelectedPipelineId] = useState(mockContentPipelines[0]?.id ?? "");
  const [notice, setNotice] = useState("콘텐츠 파이프라인은 task / approval / event / timeline 조합으로 실행됩니다.");
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<ContentPipelineDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [hermesUsage, setHermesUsage] = useState<HermesUsageSummary | null>(null);
  const [hermesUsageError, setHermesUsageError] = useState<string | null>(null);
  const [naverDraftJobs, setNaverDraftJobs] = useState<NaverDraftJob[]>([]);
  const [naverDraftPolicy, setNaverDraftPolicy] = useState<NaverDraftPolicy>({ requireApproval: true, autoAfterQa: false });
  const [naverDraftJobsLoading, setNaverDraftJobsLoading] = useState(false);
  const [naverDraftJobsError, setNaverDraftJobsError] = useState<string | null>(null);
  const [naverDraftJobBusy, setNaverDraftJobBusy] = useState(false);

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



  const refreshNaverDraftJobs = useCallback(async (pipelineId?: string) => {
    if (!pipelineId) {
      setNaverDraftJobs([]);
      return [];
    }
    setNaverDraftJobsLoading(true);
    try {
      const state = await fetchNaverDraftJobState(pipelineId);
      setNaverDraftJobs(state.jobs);
      setNaverDraftPolicy(state.policy);
      setNaverDraftJobsError(null);
      return state.jobs;
    } catch (draftError: unknown) {
      const message = draftError instanceof Error ? draftError.message : "네이버 임시저장 작업을 불러오지 못했습니다.";
      setNaverDraftJobsError(message);
      return [];
    } finally {
      setNaverDraftJobsLoading(false);
    }
  }, []);

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

  useEffect(() => {
    if (!selectedPipeline?.id) return;
    let cancelled = false;
    Promise.resolve().then(() => {
      if (!cancelled) void refreshNaverDraftJobs(selectedPipeline.id);
    });
    return () => {
      cancelled = true;
    };
  }, [refreshNaverDraftJobs, selectedPipeline?.id]);

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
        `Hermes 실제 실행은 OpenAI API 비용이 발생할 수 있습니다.\n${remainingText}\n\n이번 실행은 기획·마케팅 각 1회와 작성·QA 자동 수정 검수를 최대 3회, 총 ${HERMES_PIPELINE_REQUIRED_RUNS}회까지 Hermes Bridge로 실행합니다. 계속 실행할까요?`,
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
      let nextNotice = `${result.pipeline.title} · task ${result.pipeline.taskIds.length}개와 승인 요청이 생성되었습니다.`;
      try {
        const draftState = await fetchNaverDraftJobState(result.pipeline.id);
        setNaverDraftPolicy(draftState.policy);
        setNaverDraftJobs(draftState.jobs);
        if (draftState.policy.autoAfterQa && result.pipeline.channel === "blog") {
          const job = await createNaverDraftJob({ contentPipelineId: result.pipeline.id, approvalId: result.pipeline.approvalId ?? null });
          setNaverDraftJobs((current) => [job, ...current.filter((item) => item.id !== job.id)]);
          nextNotice = `${nextNotice} 네이버 임시저장 작업도 자동 준비되었습니다.`;
          await refreshNaverDraftJobs(result.pipeline.id);
        }
      } catch (draftError: unknown) {
        const draftMessage = draftError instanceof Error ? draftError.message : "네이버 임시저장 자동 생성 실패";
        setNaverDraftJobsError(draftMessage);
        nextNotice = `${nextNotice} 네이버 임시저장 자동 생성은 실패했습니다 · ${draftMessage}`;
      }
      setNotice(nextNotice);
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



  const handleCreateNaverDraftJob = async () => {
    const pipeline = detail?.pipeline ?? selectedPipeline;
    if (!pipeline?.id || naverDraftJobBusy) return;
    setNaverDraftJobBusy(true);
    try {
      const job = await createNaverDraftJob({ contentPipelineId: pipeline.id, approvalId: detail?.approval?.id ?? pipeline.approvalId ?? null });
      setNaverDraftJobs((current) => [job, ...current.filter((item) => item.id !== job.id)]);
      setNaverDraftJobsError(null);
      setNotice(`${pipeline.title} · 네이버 임시저장 작업이 준비되었습니다.`);
      await refreshNaverDraftJobs(pipeline.id);
    } catch (draftError: unknown) {
      const message = draftError instanceof Error ? draftError.message : "네이버 임시저장 작업 생성 실패";
      setNaverDraftJobsError(message);
      setNotice(`네이버 임시저장 작업 생성 실패 · ${message}`);
    } finally {
      setNaverDraftJobBusy(false);
    }
  };

  const handleCancelNaverDraftJob = async (jobId: string) => {
    const pipeline = detail?.pipeline ?? selectedPipeline;
    if (!pipeline?.id || naverDraftJobBusy) return;
    setNaverDraftJobBusy(true);
    try {
      const job = await cancelNaverDraftJob(jobId);
      setNaverDraftJobs((current) => [job, ...current.filter((item) => item.id !== job.id)]);
      setNaverDraftJobsError(null);
      setNotice(`${pipeline.title} · 네이버 임시저장 작업을 취소했습니다.`);
      await refreshNaverDraftJobs(pipeline.id);
    } catch (draftError: unknown) {
      const message = draftError instanceof Error ? draftError.message : "네이버 임시저장 작업 취소 실패";
      setNaverDraftJobsError(message);
    } finally {
      setNaverDraftJobBusy(false);
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
                  <NaverBlogPublishPrepPanel key={(detail?.pipeline ?? selectedPipeline).id} pipeline={detail?.pipeline ?? selectedPipeline} />
                  <NaverDraftJobPanel
                    pipeline={detail?.pipeline ?? selectedPipeline}
                    jobs={naverDraftJobs}
                    policy={naverDraftPolicy}
                    isLoading={naverDraftJobsLoading}
                    error={naverDraftJobsError}
                    isBusy={naverDraftJobBusy}
                    onCreate={handleCreateNaverDraftJob}
                    onCancel={handleCancelNaverDraftJob}
                  />
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
          {selectedPipeline ? (
            <div className="feature-card dashboard-side-summary">
              <label>운영 요약</label>
              <strong>{summarizeContentPipelineStatus(selectedPipeline)}</strong>
              <p>현재 선택된 콘텐츠 파이프라인의 단계, 승인 상태, 네이버 임시저장 준비 흐름을 운영자가 바로 읽을 수 있게 요약합니다.</p>
            </div>
          ) : null}
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
