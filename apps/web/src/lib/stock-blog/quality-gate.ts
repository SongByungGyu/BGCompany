import type { ContentPipelineRun } from "@/features/content-pipeline/content-pipeline-types";
import {
  inspectStockBlogSourceContract,
  inspectStockBlogTailContract,
  type StockBlogSourceContractInspection,
  type StockBlogTailContractInspection,
} from "@/lib/stock-blog/canonical-stock-blog-body";
import { FRED_DEGRADED_DISCLOSURE, isAllowedFredDegradedSnapshot } from "@/lib/stock-blog/references/fred-degraded-policy";
import { KIS_SECTOR_DEGRADED_DISCLOSURE, isAllowedKisSectorDegradedSnapshot } from "@/lib/stock-blog/references/kis-sector-degraded-policy";
import { KIS_OVERSEAS_DEGRADED_DISCLOSURE, isAllowedKisOverseasDegradedSnapshot } from "@/lib/stock-blog/references/kis-overseas-degraded-policy";
import type { ReferenceBundle, ReferenceItem, StockReferenceBriefingTemplate } from "@/lib/stock-blog/references/reference-types";
import {
  assessStockBlogEditorialQuality,
  inspectOwnStockBlogStructure,
  STOCK_BLOG_EDITORIAL_QUALITY_TARGET,
} from "@/lib/stock-blog/stock-blog-editorial-benchmark";
import {
  BG_MARKET_NOTE_EDITORIAL_POLICY_VERSION,
  getStockBlogEditorialPolicy,
  inspectStockBlogEditorialContract,
  STOCK_BLOG_INVESTMENT_DISCLAIMER,
  type StockBlogEditorialContractInspection,
} from "@/lib/stock-blog/stock-blog-editorial-policy";

export type StockBlogQualityStatus =
  | "passed"
  | "needs_credentials"
  | "needs_reference"
  | "needs_data"
  | "readability_failed"
  | "duplicate_content_failed"
  | "image_pending"
  | "quality_failed";

export type StockBlogQualityDiagnostics = {
  referenceProvider?: string;
  referenceMode?: string;
  totalReferenceCount: number;
  realReferenceCount: number;
  validUrlCount: number;
  distinctUrlCount: number;
  publisherCount: number;
  competitorReferenceCount: number;
  competitorAnalyzedCount: number;
  competitorAnalysisFailedCount: number;
  writerInputReferenceCount: number;
  writerNewlineCount: number;
  pasteReadyNewlineCount: number;
  doubleNewlineBlockCount: number;
  sectionHeadingCount: number;
  paragraphCount: number;
  bulletItemCount: number;
  bodyLength: number;
  duplicateSentenceCount: number;
  hasBgMarketNoteJudgment: boolean;
  hasDisclaimer: boolean;
  hasMockPhrase: boolean;
  hasImagePromptLeak: boolean;
  hasMarketDataSignal: boolean;
  marketDataReferenceCount: number;
  officialReferenceCount: number;
  newsReferenceCount: number;
  marketSnapshotStatus?: string;
  marketSnapshotDataQuality?: string;
  marketSnapshotActualDataQuality?: string;
  marketSnapshotProvider?: string;
  marketSnapshotFreshnessStatus?: string;
  marketSnapshotDegraded: boolean;
  marketSnapshotDegradedMode?: string;
  marketSnapshotDisclosures: string[];
  marketSnapshotDiagnostics: NonNullable<NonNullable<ReferenceBundle["marketSnapshot"]>["diagnostics"]>;
  hasFredDegradedDisclosure: boolean;
  hasKisSectorDegradedDisclosure: boolean;
  hasKisOverseasDegradedDisclosure: boolean;
  staleMarketDataItems: string[];
  manualMarketSnapshot: boolean;
  repeatedPhraseWarnings: string[];
  missingReferenceItems: string[];
  qaScore?: number;
  originalQaScore?: number;
  qaStructuralReconciliationApplied?: boolean;
  qaApprovalReasons?: string[];
  sourceContract: StockBlogSourceContractInspection;
  tailContract: StockBlogTailContractInspection;
  editorialQualityScore?: number;
  editorialQualityTarget?: number;
  editorialQualityPassed?: boolean;
  editorialQualityDimensions?: Record<string, number>;
  editorialQualityFailedChecks?: string[];
  editorialContract?: StockBlogEditorialContractInspection;
};

export type StockBlogQualityGateResult = {
  ok: boolean;
  status: StockBlogQualityStatus;
  reasons: string[];
  diagnostics: StockBlogQualityDiagnostics;
};

export type StockBlogQaApprovalInspection = {
  ok: boolean;
  authoritativeQaScore?: number;
  reportedQaScore?: number;
  originalQaScore?: number;
  requiredRevisionCount: number;
  legacyReconciliationDetected: boolean;
  reasons: string[];
};

function finiteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

export function inspectStockBlogQaApproval(result: unknown): StockBlogQaApprovalInspection {
  const qa = recordValue(result);
  const legacyReconciliation = recordValue(qa?.deterministicQaReconciliation);
  const reportedQaScore = finiteNumber(qa?.qaScore);
  const originalQaScore = finiteNumber(qa?.originalQaScore)
    ?? finiteNumber(legacyReconciliation?.originalQaScore);
  const scoreCandidates = [reportedQaScore, originalQaScore]
    .filter((value): value is number => value !== undefined);
  const authoritativeQaScore = scoreCandidates.length > 0
    ? Math.min(...scoreCandidates)
    : undefined;
  const requiredRevisions = qa?.requiredRevisions;
  const requiredRevisionsValid = Array.isArray(requiredRevisions)
    && requiredRevisions.every((item) => typeof item === "string" && item.trim().length > 0);
  const requiredRevisionCount = requiredRevisionsValid && Array.isArray(requiredRevisions)
    ? requiredRevisions.length
    : 0;
  const legacyReconciliationDetected = Boolean(legacyReconciliation);
  const reasons: string[] = [];
  if (qa?.ok !== true) reasons.push("qa-auditor 실행 결과 ok=true 필요");
  if (qa?.publishReadiness !== "ready") reasons.push("qa-auditor publishReadiness=ready 필요");
  if (qa?.finalRecommendation !== "approve") reasons.push("qa-auditor finalRecommendation=approve 필요");
  if (!requiredRevisionsValid) reasons.push("qa-auditor requiredRevisions는 명시적인 문자열 배열이어야 함");
  if (requiredRevisionCount > 0) reasons.push("qa-auditor 필수 수정사항 0건 필요");
  if ((authoritativeQaScore ?? 0) < STOCK_BLOG_EDITORIAL_QUALITY_TARGET) {
    reasons.push(`qa-auditor 원 판정 점수 ${STOCK_BLOG_EDITORIAL_QUALITY_TARGET}점 이상 필요`);
  }
  if (legacyReconciliationDetected) reasons.push("과거 deterministic QA 승인 보정 결과는 재검수 필요");
  return {
    ok: reasons.length === 0,
    authoritativeQaScore,
    reportedQaScore,
    originalQaScore,
    requiredRevisionCount,
    legacyReconciliationDetected,
    reasons,
  };
}

const FORBIDDEN_SOURCE_NAMES = ["Mock Market Desk", "BG Reference Lab"];
const MOCK_TEXT_PATTERNS = [
  /mock/i,
  /실제 api를 호출하지/i,
  /실제 API를 호출하지/i,
  /manual-only/i,
  /real-disabled/i,
  /수동 확인/i,
];
const IMAGE_PROMPT_PATTERNS = [
  /negative prompt/i,
  /aspect ratio/i,
  /text overlay/i,
  /네이버 블로그 썸네일/i,
  /이미지 프롬프트/i,
  /prompt:/i,
];
const MARKET_DATA_PATTERNS = [
  /코스피|KOSPI|코스닥|KOSDAQ|나스닥|NASDAQ|S&P|다우|Dow/i,
  /환율|달러|금리|국채|외국인|기관|개인|수급|거래대금/i,
  /반도체|2차전지|금융|자동차|바이오|플랫폼|방산|조선|에너지/i,
];
const DISCLAIMER_PATTERNS = [/투자 참고용/, /매수·매도 추천이 아닙니다/, /투자 판단과 책임/];
const BG_MARKET_NOTE_JUDGMENT_PATTERN = /BG\s*Market\s*Note\s*(?:의\s*)?판단/i;
const REPEATED_PHRASES = ["중요합니다", "확인할 필요가 있습니다", "살펴봐야 합니다", "방향성보다 선택이 중요합니다", "체크해야 합니다", "주목해야 합니다"];
const NEXT_WEEK_HEADINGS = [
  ...getStockBlogEditorialPolicy("NEXT_WEEK_MARKET_PREVIEW").bodyStructure
    .filter((heading) => heading !== "함께 확인한 기사"),
  "마무리",
  "함께 확인한 기사",
];
const NEXT_WEEK_DISCLAIMER = STOCK_BLOG_INVESTMENT_DISCLAIMER;
const NEXT_WEEK_FORBIDDEN_PATTERNS = [
  /\basOf\b/i,
  /JSON\s*(?:필드|field)/i,
  /데이터 수집 과정/,
  /내부 분석 과정/,
  /AI 활용 설정/i,
  /사진 설명을 입력하세요/,
  /제목과 짧은 설명을 바탕으로 재구성했습니다/,
  /^\s*시장 영향\s*$/m,
];

export function inspectNextWeekEditorialContract(body: string) {
  const articleHeadingIndex = body.indexOf("함께 확인한 기사");
  const articleEndCandidates = [
    NEXT_WEEK_DISCLAIMER,
    FRED_DEGRADED_DISCLOSURE,
    KIS_SECTOR_DEGRADED_DISCLOSURE,
    KIS_OVERSEAS_DEGRADED_DISCLOSURE,
  ]
    .map((marker) => body.indexOf(marker, Math.max(0, articleHeadingIndex + 1)))
    .filter((index) => index >= 0);
  const articleEnd = articleEndCandidates.length > 0 ? Math.min(...articleEndCandidates) : body.length;
  const articleText = articleHeadingIndex >= 0 ? body.slice(articleHeadingIndex, articleEnd) : "";
  const outsideArticleText = articleHeadingIndex >= 0
    ? `${body.slice(0, articleHeadingIndex)}\n${body.slice(articleEnd)}`
    : body;
  const articleUrls = articleText.match(/https?:\/\/[^\s)]+/g) ?? [];
  const outsideArticleUrls = outsideArticleText.match(/https?:\/\/[^\s)]+/g) ?? [];
  const articleEntryCount = articleText.split("\n").filter((line) => /^\s*[1-3]\.\s+/.test(line)).length;
  const disclaimerCount = body.split(NEXT_WEEK_DISCLAIMER).length - 1;
  let cursor = -1;
  const missingOrOutOfOrderHeadings: string[] = [];
  for (const heading of NEXT_WEEK_HEADINGS) {
    const nextIndex = body.indexOf(heading, cursor + 1);
    if (nextIndex < 0) missingOrOutOfOrderHeadings.push(heading);
    else cursor = nextIndex;
  }
  return {
    bodyCharacterCount: body.length,
    articleUrlCount: articleUrls.length,
    outsideArticleUrlCount: outsideArticleUrls.length,
    articleEntryCount,
    disclaimerCount,
    missingOrOutOfOrderHeadings,
    forbiddenTerms: NEXT_WEEK_FORBIDDEN_PATTERNS.filter((pattern) => pattern.test(body)).map((pattern) => pattern.source),
  };
}

export function hasValidStockBlogBodyLength(
  body: string,
  contentType: StockReferenceBriefingTemplate = "KOREA_DAILY_PREVIEW",
) {
  const { bodyLength } = getStockBlogEditorialPolicy(contentType);
  return body.length >= bodyLength.min && body.length <= bodyLength.max;
}

function clean(value?: string | null) {
  return typeof value === "string" ? value.trim() : "";
}

function isValidHttpUrl(value?: string) {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function hasMockSignal(item: ReferenceItem) {
  const sourceName = clean(item.publisher) || clean(item.provider);
  const searchable = [item.provider, item.publisher, item.title, item.summary, item.usageNote, item.sourceType].map(clean).join("\n");
  return FORBIDDEN_SOURCE_NAMES.includes(sourceName) || MOCK_TEXT_PATTERNS.some((pattern) => pattern.test(searchable)) || String(item.sourceType) === "mock";
}

export function isRealStockReference(item: ReferenceItem, bundle?: ReferenceBundle) {
  if (bundle?.provider === "mock" || bundle?.mode === "mock" || bundle?.mode === "real-disabled") return false;
  if (hasMockSignal(item)) return false;
  if (!clean(item.title) || !clean(item.publisher) || !clean(item.publishedAt) || !clean(item.summary)) return false;
  return isValidHttpUrl(item.url);
}

export function getRealStockReferences(bundle?: ReferenceBundle) {
  const seen = new Set<string>();
  const real: ReferenceItem[] = [];
  for (const item of bundle?.items ?? []) {
    if (!isRealStockReference(item, bundle)) continue;
    const url = clean(item.url);
    if (seen.has(url)) continue;
    seen.add(url);
    real.push(item);
  }
  return real;
}

const REFERENCE_METADATA_LINE = /^-\s*(출처|발행일|시장 영향|원문):/;

function countDuplicateSentences(body: string) {
  const proseBody = body
    .split("\n")
    .filter((line) => !REFERENCE_METADATA_LINE.test(line.trim()))
    .join("\n");
  const sentences = proseBody
    .split(/[.!?。]|\n/)
    .map((sentence) => sentence.replace(/\s+/g, " ").trim())
    .filter((sentence) => sentence.length >= 28);
  const seen = new Map<string, number>();
  for (const sentence of sentences) seen.set(sentence, (seen.get(sentence) ?? 0) + 1);
  return Array.from(seen.values()).filter((count) => count > 1).reduce((sum, count) => sum + count - 1, 0);
}

function countSectionHeadings(body: string) {
  const circled = (body.match(/[①②③④⑤⑥⑦⑧⑨]/g) ?? []).length;
  const markdown = body.split("\n").filter((line) => /^#{2,4}\s+/.test(line.trim())).length;
  const numbered = body.split("\n").filter((line) => /^\d+\.\s+\S+/.test(line.trim())).length;
  const colonLike = body.split("\n").filter((line) => /^[가-힣A-Za-z0-9·/\s]{3,28}$/.test(line.trim()) && !line.trim().startsWith("-")).length;
  return Math.max(circled, markdown + numbered + colonLike);
}

function diagnostics(input: {
  bundle?: ReferenceBundle;
  pasteReadyBody?: string;
  writerText?: string;
}): StockBlogQualityDiagnostics {
  const body = input.pasteReadyBody ?? "";
  const writerText = input.writerText ?? "";
  const refs = input.bundle?.items ?? [];
  const realRefs = getRealStockReferences(input.bundle);
  const urls = refs.map((item) => clean(item.url)).filter(Boolean);
  const realUrls = realRefs.map((item) => clean(item.url)).filter(Boolean);
  const publishers = new Set(realRefs.map((item) => clean(item.publisher)).filter(Boolean));
  const marketDataReferenceCount = realRefs.filter((item) => item.sourceType === "market_data").length;
  const officialReferenceCount = realRefs.filter((item) => item.reliability === "official").length;
  const newsReferenceCount = realRefs.filter((item) => item.sourceType === "news").length;
  const paragraphCount = body.split(/\n{2,}/).map((part) => part.trim()).filter((part) => part.length >= 20).length;
  const repeatedPhraseWarnings = REPEATED_PHRASES.filter((phrase) => body.split(phrase).length - 1 >= 3);
  const marketSnapshot = input.bundle?.marketSnapshot;
  const fredDegraded = isAllowedFredDegradedSnapshot(marketSnapshot);
  const kisSectorDegraded = isAllowedKisSectorDegradedSnapshot(marketSnapshot);
  const kisOverseasDegraded = isAllowedKisOverseasDegradedSnapshot(marketSnapshot);
  const marketSnapshotDegraded = fredDegraded || kisSectorDegraded || kisOverseasDegraded;
  const sourceContract = inspectStockBlogSourceContract(body, realRefs);
  const tailContract = inspectStockBlogTailContract(body, marketSnapshot);
  return {
    referenceProvider: input.bundle?.provider,
    referenceMode: input.bundle?.mode,
    totalReferenceCount: refs.length,
    realReferenceCount: realRefs.length,
    validUrlCount: urls.filter(isValidHttpUrl).length,
    distinctUrlCount: new Set(realUrls).size,
    publisherCount: publishers.size,
    competitorReferenceCount: input.bundle?.competitorBlogReferences?.filter((item) => isValidHttpUrl(item.url)).length ?? 0,
    competitorAnalyzedCount: input.bundle?.competitorAnalysis?.analyzedCount ?? 0,
    competitorAnalysisFailedCount: input.bundle?.competitorAnalysis?.failedCount ?? 0,
    writerInputReferenceCount: refs.length,
    writerNewlineCount: (writerText.match(/\n/g) ?? []).length,
    pasteReadyNewlineCount: (body.match(/\n/g) ?? []).length,
    doubleNewlineBlockCount: body.split(/\n{2,}/).filter((part) => part.trim().length >= 20).length,
    sectionHeadingCount: countSectionHeadings(body),
    paragraphCount,
    bulletItemCount: body.split("\n").filter((line) => line.trim().startsWith("- ")).length,
    bodyLength: body.length,
    duplicateSentenceCount: countDuplicateSentences(body),
    hasBgMarketNoteJudgment: BG_MARKET_NOTE_JUDGMENT_PATTERN.test(body),
    hasDisclaimer: DISCLAIMER_PATTERNS.some((pattern) => pattern.test(body)),
    hasMockPhrase: MOCK_TEXT_PATTERNS.some((pattern) => pattern.test(body)) || FORBIDDEN_SOURCE_NAMES.some((name) => body.includes(name)),
    hasImagePromptLeak: IMAGE_PROMPT_PATTERNS.some((pattern) => pattern.test(body)),
    hasMarketDataSignal: MARKET_DATA_PATTERNS.some((pattern) => pattern.test(body)),
    marketDataReferenceCount,
    officialReferenceCount,
    newsReferenceCount,
    marketSnapshotStatus: marketSnapshot?.status,
    marketSnapshotDataQuality: marketSnapshotDegraded ? "verified" : marketSnapshot?.dataQuality,
    marketSnapshotActualDataQuality: marketSnapshot?.dataQuality,
    marketSnapshotProvider: marketSnapshot?.provider,
    marketSnapshotFreshnessStatus: marketSnapshot?.freshness?.status,
    marketSnapshotDegraded,
    marketSnapshotDegradedMode: marketSnapshot?.degradedMode,
    marketSnapshotDisclosures: marketSnapshot?.disclosures ?? [],
    marketSnapshotDiagnostics: marketSnapshot?.diagnostics ?? [],
    hasFredDegradedDisclosure: body.includes(FRED_DEGRADED_DISCLOSURE),
    hasKisSectorDegradedDisclosure: body.includes(KIS_SECTOR_DEGRADED_DISCLOSURE),
    hasKisOverseasDegradedDisclosure: body.includes(KIS_OVERSEAS_DEGRADED_DISCLOSURE),
    staleMarketDataItems: marketSnapshot?.freshness?.staleItems ?? [],
    manualMarketSnapshot: marketSnapshot?.provider === "manual",
    repeatedPhraseWarnings,
    missingReferenceItems: input.bundle?.missingItems ?? [],
    sourceContract,
    tailContract,
  };
}

export function evaluateStockBlogReferences(bundle?: ReferenceBundle, requireRealReferences = false): StockBlogQualityGateResult {
  const d = diagnostics({ bundle });
  const reasons: string[] = [];
  if (requireRealReferences) {
    const minRefs = 5;
    const minUrls = 5;
    const minPublishers = 3;
    if (d.realReferenceCount < minRefs) reasons.push(`실제 참고자료 ${minRefs}개 이상 필요`);
    if (d.distinctUrlCount < minUrls) reasons.push(`중복되지 않는 실제 URL ${minUrls}개 이상 필요`);
    if (d.publisherCount < minPublishers) reasons.push(`서로 다른 발행처 ${minPublishers}곳 이상 필요`);
    if (d.newsReferenceCount < 3) reasons.push("실제 뉴스 참고자료 3개 이상 필요");
    if (d.marketDataReferenceCount + d.officialReferenceCount < 1 && d.marketSnapshotDataQuality !== "verified") reasons.push("시장 데이터 또는 공식/신뢰 참고자료 1개 이상 필요");
    if (d.competitorReferenceCount < 3) reasons.push("경쟁 블로그 참고자료 3개 이상 필요");
    if (process.env.COMPETITOR_BLOG_DEEP_ANALYSIS_REQUIRED === "true" && d.competitorAnalyzedCount < 1) reasons.push("경쟁 블로그 심층 구조 분석 1개 이상 필요");
    if (d.marketSnapshotStatus !== "ready" || d.marketSnapshotDataQuality !== "verified") reasons.push("검증된 MarketSnapshot 필요");
    if (d.marketSnapshotFreshnessStatus !== "fresh") reasons.push("최신성 검증을 통과한 MarketSnapshot 필요");
    if (d.staleMarketDataItems.length > 0) reasons.push(`오래되거나 유효하지 않은 시장 데이터: ${d.staleMarketDataItems.join(", ")}`);
    if (d.manualMarketSnapshot && process.env.STOCK_MARKET_DATA_ALLOW_MANUAL_IN_HERMES !== "true") reasons.push("Manual MarketSnapshot은 운영 Hermes에서 기본 차단됨");
    if (d.missingReferenceItems.length > 0) reasons.push(`필수 참고자료 부족: ${d.missingReferenceItems.join(", ")}`);
  }
  if (bundle?.status === "needs_credentials" || (requireRealReferences && bundle?.status === "disabled")) return { ok: false, status: "needs_credentials", reasons: reasons.length ? reasons : ["실제 Reference Provider credentials 필요"], diagnostics: d };
  if (d.marketSnapshotStatus === "needs_credentials") return { ok: false, status: "needs_credentials", reasons: [...reasons, "시장 데이터 Provider credentials 필요"], diagnostics: d };
  if (bundle?.status === "needs_data" || bundle?.status === "error" || d.marketSnapshotStatus === "needs_data" || d.marketSnapshotStatus === "error" || d.marketSnapshotFreshnessStatus === "stale" || d.marketSnapshotFreshnessStatus === "expired" || d.marketSnapshotFreshnessStatus === "unknown") {
    return { ok: false, status: "needs_data", reasons: reasons.length ? reasons : ["검증된 MarketSnapshot 데이터 필요"], diagnostics: d };
  }
  if (requireRealReferences && d.manualMarketSnapshot && process.env.STOCK_MARKET_DATA_ALLOW_MANUAL_IN_HERMES !== "true") {
    return { ok: false, status: "needs_data", reasons, diagnostics: d };
  }
  if (d.referenceProvider === "mock" || d.referenceMode === "mock" || d.referenceMode === "real-disabled") reasons.push("mock/real-disabled 참고자료는 운영 Hermes 결과로 인정하지 않음");
  if (reasons.length > 0) return { ok: false, status: "needs_reference", reasons, diagnostics: d };
  return { ok: true, status: "passed", reasons: [], diagnostics: d };
}

export function inspectStockBlogImagePublishReadiness(pipeline: ContentPipelineRun) {
  const reasons: string[] = [];
  if (pipeline.imageStatus !== "generated") reasons.push("imageStatus=generated 필요");
  if (!clean(pipeline.thumbnailImageUrl ?? pipeline.naverBlogPublishPrep?.thumbnailImageUrl)) reasons.push("thumbnailImageUrl 필요");
  if ((pipeline.inlineImageUrls ?? pipeline.naverBlogPublishPrep?.inlineImageUrls ?? []).length < 1) reasons.push("inlineImageUrls 1개 이상 필요");
  const contentImages = pipeline.contentImages ?? [];
  const bodyImages = contentImages.filter((image) => image.role === "body");
  if (pipeline.imageQuality?.status !== "passed") reasons.push("imageQuality=passed 필요");
  if (bodyImages.length < 2 || bodyImages.length > 4) reasons.push("본문 이미지 2~4장 필요");
  if (bodyImages.some((image) => !image.fileVerified || !image.usageAllowed || !image.placementAfterHeading || !image.caption || !image.sourceLabel)) {
    reasons.push("본문 이미지 파일·라이선스·섹션 연결 검증 필요");
  }
  if (bodyImages.every((image) => image.type !== "chart")) reasons.push("검증 수치 기반 본문 차트 1장 이상 필요");
  return reasons;
}

export function evaluateStockBlogPublishQuality(input: {
  pipeline: ContentPipelineRun;
  referenceBundle?: ReferenceBundle;
  pasteReadyBody?: string;
  writerText?: string;
  requireRealReferences?: boolean;
}): StockBlogQualityGateResult {
  const bundle = input.referenceBundle ?? input.pipeline.referenceBundle ?? input.pipeline.writerResult?.referenceBundle ?? input.pipeline.qaResult?.referenceBundle;
  const body = input.pasteReadyBody ?? input.pipeline.naverBlogPublishPrep?.pasteReadyBody ?? input.pipeline.writerResult?.fullDraft ?? "";
  const writerText = input.writerText ?? input.pipeline.writerResult?.fullDraft ?? input.pipeline.writerResult?.markdownDraft ?? "";
  const baseDiagnostics = diagnostics({ bundle, pasteReadyBody: body, writerText });
  const reasons: string[] = [];
  const requireReal = input.requireRealReferences ?? input.pipeline.runnerMode === "hermes";
  const contentType = bundle?.contentType ?? "KOREA_DAILY_PREVIEW";
  const policy = getStockBlogEditorialPolicy(contentType);
  const publicEditorialContract = inspectStockBlogEditorialContract(body, contentType);
  const qaApproval = inspectStockBlogQaApproval(input.pipeline.qaResult);
  const effectiveQaScore = qaApproval.authoritativeQaScore;
  const imagePublishReadinessReasons = requireReal
    ? inspectStockBlogImagePublishReadiness(input.pipeline)
    : [];
  const nextWeekPreview = contentType === "NEXT_WEEK_MARKET_PREVIEW";
  const editorialContract = nextWeekPreview ? inspectNextWeekEditorialContract(body) : undefined;
  const imageCount = input.pipeline.contentImages?.length
    ?? (input.pipeline.thumbnailImageUrl ? 1 : 0) + (input.pipeline.inlineImageUrls?.length ?? 0);
  const editorialQuality = assessStockBlogEditorialQuality({
    structure: inspectOwnStockBlogStructure({
      title: input.pipeline.writerResult?.finalTitle ?? input.pipeline.outputTitle ?? input.pipeline.title,
      body,
      imageCount,
      contentType,
    }),
    contentType,
    realReferenceCount: baseDiagnostics.realReferenceCount,
    publisherCount: baseDiagnostics.publisherCount,
    verifiedMarketSnapshot: baseDiagnostics.marketSnapshotStatus === "ready"
      && baseDiagnostics.marketSnapshotDataQuality === "verified"
      && baseDiagnostics.marketSnapshotFreshnessStatus === "fresh",
    qaScore: effectiveQaScore,
  });
  const d: StockBlogQualityDiagnostics = {
    ...baseDiagnostics,
    qaScore: effectiveQaScore,
    originalQaScore: qaApproval.originalQaScore ?? qaApproval.reportedQaScore,
    qaStructuralReconciliationApplied: qaApproval.legacyReconciliationDetected,
    qaApprovalReasons: qaApproval.reasons,
    editorialQualityScore: editorialQuality.score,
    editorialQualityTarget: editorialQuality.target,
    editorialQualityPassed: editorialQuality.passed,
    editorialQualityDimensions: editorialQuality.dimensions,
    editorialQualityFailedChecks: editorialQuality.failedChecks,
    editorialContract: publicEditorialContract,
  };

  if (requireReal && !d.sourceContract.ok) {
    reasons.push("함께 확인한 기사에는 선택된 실제 기사 제목과 원문 URL을 정확히 3개 표시해야 함");
  }
  if (requireReal && !d.sourceContract.onlyDisclaimerAfterSource) reasons.push("함께 확인한 기사 뒤에는 투자 유의문구만 있어야 함");
  if (requireReal && !qaApproval.ok) reasons.push(...qaApproval.reasons);
  if (requireReal && d.tailContract.disclaimerCount !== 1) reasons.push("지정 투자 유의문구 정확히 1회 필요");
  if (requireReal && !d.tailContract.disclaimerIsLast) reasons.push("투자 유의문구는 공개 본문의 마지막 문단이어야 함");
  if (requireReal && d.tailContract.missingDisclosures.length > 0) reasons.push("허용된 시장 데이터 제한 모드 고지 문구 누락");
  if (requireReal && d.tailContract.unexpectedDisclosures.length > 0) reasons.push("현재 MarketSnapshot과 일치하지 않는 시장 데이터 제한 고지 포함");
  if (requireReal && !d.tailContract.disclosuresBeforeDisclaimer) reasons.push("시장 데이터 제한 고지는 투자 유의문구 앞에 있어야 함");
  if (requireReal && !editorialQuality.passed) {
    reasons.push(`편집 품질 ${STOCK_BLOG_EDITORIAL_QUALITY_TARGET}점 이상 필요: 현재 ${editorialQuality.score}점 · ${editorialQuality.failedChecks.join(", ")}`);
  }
  reasons.push(...imagePublishReadinessReasons);

  if (requireReal) {
    const minRefs = 5;
    const minUrls = 5;
    const minPublishers = 3;
    if (d.realReferenceCount < minRefs) reasons.push(`실제 참고자료 ${minRefs}개 이상 필요`);
    if (d.distinctUrlCount < minUrls) reasons.push(`중복되지 않는 실제 URL ${minUrls}개 이상 필요`);
    if (d.publisherCount < minPublishers) reasons.push(`서로 다른 발행처 ${minPublishers}곳 이상 필요`);
    if (d.newsReferenceCount < 3) reasons.push("실제 뉴스 참고자료 3개 이상 필요");
    if (d.marketDataReferenceCount + d.officialReferenceCount < 1 && d.marketSnapshotDataQuality !== "verified") reasons.push("시장 데이터 또는 공식/신뢰 참고자료 1개 이상 필요");
    if (d.competitorReferenceCount < 3) reasons.push("경쟁 블로그 참고자료 3개 이상 필요");
    if (process.env.COMPETITOR_BLOG_DEEP_ANALYSIS_REQUIRED === "true" && d.competitorAnalyzedCount < 1) reasons.push("경쟁 블로그 심층 구조 분석 1개 이상 필요");
    if (d.marketSnapshotStatus !== "ready" || d.marketSnapshotDataQuality !== "verified") reasons.push("검증된 MarketSnapshot 필요");
    if (d.marketSnapshotFreshnessStatus !== "fresh") reasons.push("최신성 검증을 통과한 MarketSnapshot 필요");
    if (d.staleMarketDataItems.length > 0) reasons.push(`오래되거나 유효하지 않은 시장 데이터: ${d.staleMarketDataItems.join(", ")}`);
    if (d.manualMarketSnapshot && process.env.STOCK_MARKET_DATA_ALLOW_MANUAL_IN_HERMES !== "true") reasons.push("Manual MarketSnapshot은 운영 Hermes에서 기본 차단됨");
    if (d.missingReferenceItems.length > 0) reasons.push(`필수 참고자료 부족: ${d.missingReferenceItems.join(", ")}`);
  }
  if (!d.hasMarketDataSignal && requireReal) reasons.push("지수/섹터/수급 등 시장 데이터 신호 부족");
  if (requireReal && !d.hasBgMarketNoteJudgment) reasons.push("BG Market Note 판단 섹션 필요");
  if (d.pasteReadyNewlineCount < 15) reasons.push("최종 본문 줄바꿈 15개 이상 필요");
  if (d.doubleNewlineBlockCount < 8) reasons.push("최종 본문 문단 블록 8개 이상 필요");
  if (d.sectionHeadingCount < policy.minimumHeadingCount) reasons.push(`섹션 제목 ${policy.minimumHeadingCount}개 이상 필요`);
  if (d.paragraphCount < policy.minimumParagraphCount) reasons.push(`최종 본문 문단 ${policy.minimumParagraphCount}개 이상 필요`);
  if (requireReal && publicEditorialContract.violations.length > 0) {
    reasons.push(...publicEditorialContract.violations.map((reason) => `편집 정책 v${BG_MARKET_NOTE_EDITORIAL_POLICY_VERSION}: ${reason}`));
  }
  if (requireReal && d.distinctUrlCount < 5) reasons.push("최종 본문용 실제 URL 5개 이상 필요");
  if (nextWeekPreview && editorialContract) {
    if (!hasValidStockBlogBodyLength(body, contentType)) reasons.push(`다음 주 전망 공개 본문은 공백 포함 ${policy.bodyLength.min}~${policy.bodyLength.max}자 필요`);
    if (editorialContract.articleEntryCount !== 3 || editorialContract.articleUrlCount !== 3) reasons.push("함께 확인한 기사 3개와 원문 링크 3개 필요");
    if (editorialContract.outsideArticleUrlCount > 0) reasons.push("함께 확인한 기사 밖의 본문 중간 링크 노출 금지");
    if (editorialContract.disclaimerCount !== 1) reasons.push("지정 투자 유의문구 정확히 1회 필요");
    if (editorialContract.missingOrOutOfOrderHeadings.length > 0) reasons.push(`주간 전망 섹션 누락 또는 순서 오류: ${editorialContract.missingOrOutOfOrderHeadings.join(", ")}`);
    if (editorialContract.forbiddenTerms.length > 0) reasons.push("내부·시스템·기계적 용어가 공개 본문에 포함됨");
  } else if (!hasValidStockBlogBodyLength(body, contentType)) reasons.push(`최종 본문은 공백 포함 ${policy.bodyLength.min}~${policy.bodyLength.max}자 필요`);
  if (!d.hasDisclaimer) reasons.push("투자 유의문구 누락");
  if (d.hasMockPhrase) reasons.push("mock/수동 확인 문구가 최종 본문에 포함됨");
  if (d.hasImagePromptLeak) reasons.push("이미지 프롬프트가 최종 본문에 섞임");
  if (d.duplicateSentenceCount > 1) reasons.push("중복 문장 반복이 과도함");
  if (d.repeatedPhraseWarnings.length > 0) reasons.push(`상투적 반복 문구 3회 이상: ${d.repeatedPhraseWarnings.join(", ")}`);

  if (reasons.length === 0) return { ok: true, status: "passed", reasons: [], diagnostics: d };
  if (reasons.some((reason) => reason.includes("참고자료") || reason.includes("URL") || reason.includes("발행처") || reason.includes("mock/real-disabled") || reason.includes("공식/신뢰"))) {
    return { ok: false, status: "needs_reference", reasons, diagnostics: d };
  }
  if (reasons.some((reason) => reason.includes("시장 데이터") || reason.includes("MarketSnapshot") || reason.includes("최신성"))) return { ok: false, status: "needs_data", reasons, diagnostics: d };
  if (imagePublishReadinessReasons.length > 0) return { ok: false, status: "image_pending", reasons, diagnostics: d };
  if (d.hasImagePromptLeak) return { ok: false, status: "image_pending", reasons, diagnostics: d };
  if (d.duplicateSentenceCount > 1) return { ok: false, status: "duplicate_content_failed", reasons, diagnostics: d };
  if (
    d.pasteReadyNewlineCount < 15
    || d.doubleNewlineBlockCount < 8
    || d.sectionHeadingCount < policy.minimumHeadingCount
    || d.paragraphCount < policy.minimumParagraphCount
    || publicEditorialContract.violations.some((reason) => /30초 요약|핵심 숫자|핵심 변수|시나리오|초보자|확인 항목|빈 문단/.test(reason))
  ) {
    return { ok: false, status: "readability_failed", reasons, diagnostics: d };
  }
  return { ok: false, status: "quality_failed", reasons, diagnostics: d };
}
