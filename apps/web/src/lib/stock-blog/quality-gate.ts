import type { ContentPipelineRun } from "@/features/content-pipeline/content-pipeline-types";
import { FRED_DEGRADED_DISCLOSURE, isAllowedFredDegradedSnapshot } from "@/lib/stock-blog/references/fred-degraded-policy";
import type { ReferenceBundle, ReferenceItem } from "@/lib/stock-blog/references/reference-types";

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
  writerInputReferenceCount: number;
  writerNewlineCount: number;
  pasteReadyNewlineCount: number;
  doubleNewlineBlockCount: number;
  sectionHeadingCount: number;
  paragraphCount: number;
  bulletItemCount: number;
  bodyLength: number;
  duplicateSentenceCount: number;
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
  hasFredDegradedDisclosure: boolean;
  staleMarketDataItems: string[];
  manualMarketSnapshot: boolean;
  repeatedPhraseWarnings: string[];
  missingReferenceItems: string[];
};

export type StockBlogQualityGateResult = {
  ok: boolean;
  status: StockBlogQualityStatus;
  reasons: string[];
  diagnostics: StockBlogQualityDiagnostics;
};

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
const REPEATED_PHRASES = ["중요합니다", "확인할 필요가 있습니다", "살펴봐야 합니다", "방향성보다 선택이 중요합니다", "체크해야 합니다", "주목해야 합니다"];

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

function countDuplicateSentences(body: string) {
  const sentences = body
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
  const colonLike = body.split("\n").filter((line) => /^[가-힣A-Za-z0-9·/\s]{3,28}$/.test(line.trim()) && !line.trim().startsWith("-")).length;
  return Math.max(circled, markdown + colonLike);
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
  const marketSnapshotDegraded = isAllowedFredDegradedSnapshot(marketSnapshot);
  return {
    referenceProvider: input.bundle?.provider,
    referenceMode: input.bundle?.mode,
    totalReferenceCount: refs.length,
    realReferenceCount: realRefs.length,
    validUrlCount: urls.filter(isValidHttpUrl).length,
    distinctUrlCount: new Set(realUrls).size,
    publisherCount: publishers.size,
    competitorReferenceCount: input.bundle?.competitorBlogReferences?.filter((item) => isValidHttpUrl(item.url)).length ?? 0,
    writerInputReferenceCount: refs.length,
    writerNewlineCount: (writerText.match(/\n/g) ?? []).length,
    pasteReadyNewlineCount: (body.match(/\n/g) ?? []).length,
    doubleNewlineBlockCount: body.split(/\n{2,}/).filter((part) => part.trim().length >= 20).length,
    sectionHeadingCount: countSectionHeadings(body),
    paragraphCount,
    bulletItemCount: body.split("\n").filter((line) => line.trim().startsWith("- ")).length,
    bodyLength: body.replace(/\s/g, "").length,
    duplicateSentenceCount: countDuplicateSentences(body),
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
    hasFredDegradedDisclosure: body.includes(FRED_DEGRADED_DISCLOSURE),
    staleMarketDataItems: marketSnapshot?.freshness?.staleItems ?? [],
    manualMarketSnapshot: marketSnapshot?.provider === "manual",
    repeatedPhraseWarnings,
    missingReferenceItems: input.bundle?.missingItems ?? [],
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
  const d = diagnostics({ bundle, pasteReadyBody: body, writerText });
  const reasons: string[] = [];
  const requireReal = input.requireRealReferences ?? input.pipeline.runnerMode === "hermes";

  if (d.marketSnapshotDegraded && !d.hasFredDegradedDisclosure) reasons.push("FRED 제한 모드 고지 문구 누락");

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
    if (d.marketSnapshotStatus !== "ready" || d.marketSnapshotDataQuality !== "verified") reasons.push("검증된 MarketSnapshot 필요");
    if (d.marketSnapshotFreshnessStatus !== "fresh") reasons.push("최신성 검증을 통과한 MarketSnapshot 필요");
    if (d.staleMarketDataItems.length > 0) reasons.push(`오래되거나 유효하지 않은 시장 데이터: ${d.staleMarketDataItems.join(", ")}`);
    if (d.manualMarketSnapshot && process.env.STOCK_MARKET_DATA_ALLOW_MANUAL_IN_HERMES !== "true") reasons.push("Manual MarketSnapshot은 운영 Hermes에서 기본 차단됨");
    if (d.missingReferenceItems.length > 0) reasons.push(`필수 참고자료 부족: ${d.missingReferenceItems.join(", ")}`);
  }
  if (!d.hasMarketDataSignal && requireReal) reasons.push("지수/섹터/수급 등 시장 데이터 신호 부족");
  if (d.pasteReadyNewlineCount < 15) reasons.push("최종 본문 줄바꿈 15개 이상 필요");
  if (d.doubleNewlineBlockCount < 8) reasons.push("최종 본문 문단 블록 8개 이상 필요");
  if (d.sectionHeadingCount < 6) reasons.push("섹션 제목 6개 이상 필요");
  if (d.paragraphCount < 10) reasons.push("최종 본문 문단 10개 이상 필요");
  if (d.bulletItemCount < 5) reasons.push("투자자 체크리스트/불릿 5개 이상 필요");
  if (requireReal && d.distinctUrlCount < 5) reasons.push("최종 본문용 실제 URL 5개 이상 필요");
  if (d.bodyLength < 2000) reasons.push("최종 본문 길이 2000자 이상 필요");
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
  if (d.hasImagePromptLeak) return { ok: false, status: "image_pending", reasons, diagnostics: d };
  if (d.duplicateSentenceCount > 1) return { ok: false, status: "duplicate_content_failed", reasons, diagnostics: d };
  if (d.pasteReadyNewlineCount < 15 || d.doubleNewlineBlockCount < 8 || d.sectionHeadingCount < 6 || d.paragraphCount < 10 || d.bulletItemCount < 5) {
    return { ok: false, status: "readability_failed", reasons, diagnostics: d };
  }
  return { ok: false, status: "quality_failed", reasons, diagnostics: d };
}
