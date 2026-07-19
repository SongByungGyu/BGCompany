import { stripHtml } from "./reference-normalizer";
import type {
  CompetitorBlogAnalysisSummary,
  CompetitorBlogReference,
  CompetitorBlogStructureMetrics,
} from "./reference-types";

type AnalysisOptions = {
  maxBytes?: number;
  timeoutMs?: number;
};

const DEFAULT_MAX_BYTES = 750_000;
const DEFAULT_TIMEOUT_MS = 10_000;
const ALLOWED_NAVER_BLOG_HOSTS = new Set(["blog.naver.com", "m.blog.naver.com", "post.naver.com"]);

function countMatches(value: string, pattern: RegExp) {
  return (value.match(pattern) ?? []).length;
}

function cleanHtmlText(value: string) {
  return stripHtml(value
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, " ")
    .replace(/<(?:br|\/p|\/div|\/li|\/h[1-6])\s*[^>]*>/gi, "\n"))
    .replace(/\s*\n\s*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function extractDivAtMarker(html: string, markerIndex: number) {
  const lower = html.toLowerCase();
  const start = lower.lastIndexOf("<div", markerIndex);
  if (start < 0) return null;
  const tagPattern = /<\/?div\b[^>]*>/gi;
  tagPattern.lastIndex = start;
  let depth = 0;
  let match: RegExpExecArray | null;
  while ((match = tagPattern.exec(html)) !== null) {
    if (/^<\/div/i.test(match[0])) depth -= 1;
    else depth += 1;
    if (depth === 0) return html.slice(start, tagPattern.lastIndex);
  }
  return null;
}

function contentRegion(html: string) {
  const markers = ["se-main-container", "postViewArea", "__se_component_area", "post-view"];
  const lower = html.toLowerCase();
  for (const marker of markers) {
    const index = lower.indexOf(marker.toLowerCase());
    if (index >= 0) return extractDivAtMarker(html, index) ?? html.slice(Math.max(0, index - 500));
  }
  return html;
}

function uniqueAttributeCount(html: string, pattern: RegExp) {
  const values = new Set<string>();
  for (const match of html.matchAll(pattern)) {
    const value = match[1]?.replaceAll("&amp;", "&").trim();
    if (!value || value === "#" || /^(?:javascript:|data:)/i.test(value)) continue;
    values.add(value);
  }
  return values.size;
}

function normalizeBlogUrl(value: string, base?: string) {
  try {
    const url = new URL(value.replaceAll("&amp;", "&"), base);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (!ALLOWED_NAVER_BLOG_HOSTS.has(url.hostname.toLowerCase())) return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

async function readHtmlResponse(response: Response, maxBytes: number) {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("text/html")) throw new Error("COMPETITOR_NOT_HTML");
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let html = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error("COMPETITOR_HTML_TOO_LARGE");
    }
    html += decoder.decode(value, { stream: true });
  }
  return html + decoder.decode();
}

async function fetchHtml(url: string, options: Required<AnalysisOptions>) {
  const normalized = normalizeBlogUrl(url);
  if (!normalized) throw new Error("COMPETITOR_URL_NOT_ALLOWED");
  const response = await fetch(normalized, {
    headers: {
      "accept": "text/html,application/xhtml+xml",
      "user-agent": "Mozilla/5.0 (compatible; BGCompanyStructureAnalyzer/1.0)",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(options.timeoutMs),
  });
  if (!response.ok) throw new Error(`COMPETITOR_HTTP_${response.status}`);
  const finalUrl = normalizeBlogUrl(response.url || normalized);
  if (!finalUrl) throw new Error("COMPETITOR_REDIRECT_NOT_ALLOWED");
  return { html: await readHtmlResponse(response, options.maxBytes), url: finalUrl };
}

function findMainFrameUrl(html: string, baseUrl: string) {
  const candidates = Array.from(html.matchAll(/<iframe\b[^>]*(?:src|data-src)=["']([^"']+)["'][^>]*>/gi));
  for (const match of candidates) {
    const raw = match[1];
    if (!/PostView\.naver|blog\.naver\.com/i.test(raw)) continue;
    const normalized = normalizeBlogUrl(raw, baseUrl);
    if (normalized) return normalized;
  }
  return null;
}

function signalsFromMetrics(metrics: CompetitorBlogStructureMetrics) {
  const signals: string[] = [];
  const bodyLength = metrics.bodyLength ?? 0;
  const paragraphCount = metrics.paragraphCount ?? 0;
  const headingCount = metrics.headingCount ?? 0;
  const imageCount = metrics.imageCount ?? 0;
  signals.push(`본문 약 ${bodyLength.toLocaleString("ko-KR")}자`);
  signals.push(`문단 ${paragraphCount}개 · 소제목 ${headingCount}개`);
  if (imageCount > 0) signals.push(`이미지 ${imageCount}개 배치`);
  if (metrics.hasChecklist) signals.push("체크리스트/체크포인트 사용");
  if (metrics.hasSourceSection) signals.push("출처·참고자료 섹션 사용");
  if (metrics.hasDisclaimer) signals.push("투자 유의문구 사용");
  if (metrics.hasCallToAction) signals.push("댓글·구독 등 CTA 사용");
  return signals;
}

export function analyzeCompetitorHtml(input: { html: string; title: string; sourceUrl?: string; analyzedAt?: string }): CompetitorBlogStructureMetrics {
  const region = contentRegion(input.html);
  const text = cleanHtmlText(region);
  const textParagraphs = text.split(/\n{2,}/).filter((part) => part.replace(/\s/g, "").length >= 25).length;
  const paragraphTexts = Array.from(region.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi))
    .map((match) => cleanHtmlText(match[1]).replace(/\s/g, ""))
    .filter((part) => part.length >= 5);
  const substantiveParagraphs = paragraphTexts.filter((part) => part.length >= 25);
  const headingTags = countMatches(region, /<h[1-6]\b/gi);
  const smartEditorHeadings = countMatches(region, /se-(?:section-title|documentTitle)|se_title/gi);
  const styledHeadings = countMatches(region, /se-fs-fs(?:24|28|30|32|34|36|38|40)/gi);
  const circledHeadings = countMatches(text, /[①②③④⑤⑥⑦⑧⑨]/g);
  const metrics: CompetitorBlogStructureMetrics = {
    status: "analyzed",
    analyzedAt: input.analyzedAt ?? new Date().toISOString(),
    sourceUrl: input.sourceUrl,
    titleLength: input.title.replace(/\s/g, "").length,
    bodyLength: text.replace(/\s/g, "").length,
    introLength: substantiveParagraphs[0]?.length ?? Math.min(text.replace(/\s/g, "").length, 300),
    paragraphCount: Math.max(paragraphTexts.length, textParagraphs),
    headingCount: Math.max(headingTags + smartEditorHeadings, styledHeadings, circledHeadings),
    imageCount: uniqueAttributeCount(region, /<img\b[^>]*(?:src|data-src|data-lazy-src)=["']([^"']+)["'][^>]*>/gi) || countMatches(region, /<img\b/gi),
    linkCount: uniqueAttributeCount(region, /<a\b[^>]*href=["']([^"']+)["'][^>]*>/gi),
    listItemCount: countMatches(region, /<li\b/gi) + countMatches(text, /(?:^|\n)\s*(?:[-*•]|\d+[.)])\s+/g),
    tableCount: countMatches(region, /<table\b/gi),
    hasDateInTitle: /(?:20\d{2}[./-]\d{1,2}[./-]\d{1,2}|\d{1,2}[./]\d{1,2}|\d{1,2}월\s*\d{1,2}일)/.test(input.title),
    hasChecklist: /체크\s*(?:리스트|포인트)|확인할\s*(?:사항|항목)|점검할\s*(?:사항|항목)/i.test(text),
    hasSourceSection: /(?:출처|참고\s*자료|원문|references?)\s*[:：]?/i.test(text),
    hasDisclaimer: /투자\s*(?:판단|책임)|매수[·ㆍ\s-]*매도\s*추천|투자\s*참고용|투자자\s*본인/i.test(text),
    hasCallToAction: /이웃\s*추가|공감|댓글|구독|좋아요|알림\s*설정/i.test(text),
    observedStructure: [],
  };
  metrics.observedStructure = signalsFromMetrics(metrics);
  return metrics;
}

export async function analyzeCompetitorBlogReference(reference: CompetitorBlogReference, options: AnalysisOptions = {}): Promise<CompetitorBlogReference> {
  const resolvedOptions: Required<AnalysisOptions> = {
    maxBytes: Math.max(100_000, options.maxBytes ?? DEFAULT_MAX_BYTES),
    timeoutMs: Math.max(1_000, options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
  };
  if (!reference.url) return {
    ...reference,
    structure: { status: "metadata_only", analyzedAt: new Date().toISOString(), observedStructure: ["원문 URL 없음"] },
  };
  try {
    let page = await fetchHtml(reference.url, resolvedOptions);
    const mainFrameUrl = findMainFrameUrl(page.html, page.url);
    if (mainFrameUrl && mainFrameUrl !== page.url) page = await fetchHtml(mainFrameUrl, resolvedOptions);
    const structure = analyzeCompetitorHtml({ html: page.html, title: reference.title, sourceUrl: page.url });
    return { ...reference, observedStructure: structure.observedStructure, structure };
  } catch (error) {
    const code = error instanceof Error ? error.message : "COMPETITOR_ANALYSIS_FAILED";
    return {
      ...reference,
      observedStructure: ["검색 결과 메타데이터만 수집"],
      structure: {
        status: "fetch_failed",
        analyzedAt: new Date().toISOString(),
        sourceUrl: reference.url,
        errorCode: code.slice(0, 80),
        observedStructure: ["원문 구조 분석 실패 · 검색 메타데이터만 사용"],
      },
    };
  }
}

function roundedAverage(values: number[]) {
  if (values.length === 0) return 0;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

export function summarizeCompetitorStructures(references: CompetitorBlogReference[]): CompetitorBlogAnalysisSummary {
  const analyzed = references.map((item) => item.structure).filter((item): item is CompetitorBlogStructureMetrics => item?.status === "analyzed");
  const ratio = (predicate: (item: CompetitorBlogStructureMetrics) => boolean) => analyzed.length > 0
    ? analyzed.filter(predicate).length / analyzed.length
    : 0;
  const commonPatterns: string[] = [];
  if (ratio((item) => item.hasDateInTitle === true) >= 0.5) commonPatterns.push("제목에 날짜를 포함하는 글이 절반 이상");
  if (ratio((item) => (item.imageCount ?? 0) >= 2) >= 0.5) commonPatterns.push("본문 이미지를 2개 이상 사용하는 글이 절반 이상");
  if (ratio((item) => item.hasChecklist === true) >= 0.5) commonPatterns.push("체크리스트 또는 체크포인트를 사용하는 글이 절반 이상");
  if (ratio((item) => item.hasCallToAction === true) >= 0.5) commonPatterns.push("댓글·구독 등 CTA를 사용하는 글이 절반 이상");
  const differentiationOpportunities: string[] = [];
  if (ratio((item) => item.hasSourceSection === true) < 0.7) differentiationOpportunities.push("경쟁 글보다 명확한 실제 출처·원문 URL 섹션 제공");
  if (ratio((item) => item.hasDisclaimer === true) < 0.7) differentiationOpportunities.push("투자 유의문구와 데이터 기준일을 명확하게 표시");
  if (ratio((item) => item.hasChecklist === true) < 0.7) differentiationOpportunities.push("실행 가능한 투자자 체크리스트로 차별화");
  differentiationOpportunities.push("KIS/FRED 검증 데이터와 뉴스 근거를 분리해 제시");
  return {
    requestedCount: references.length,
    analyzedCount: analyzed.length,
    failedCount: references.filter((item) => item.structure?.status === "fetch_failed").length,
    averages: {
      titleLength: roundedAverage(analyzed.map((item) => item.titleLength ?? 0)),
      bodyLength: roundedAverage(analyzed.map((item) => item.bodyLength ?? 0)),
      introLength: roundedAverage(analyzed.map((item) => item.introLength ?? 0)),
      paragraphCount: roundedAverage(analyzed.map((item) => item.paragraphCount ?? 0)),
      headingCount: roundedAverage(analyzed.map((item) => item.headingCount ?? 0)),
      imageCount: roundedAverage(analyzed.map((item) => item.imageCount ?? 0)),
      linkCount: roundedAverage(analyzed.map((item) => item.linkCount ?? 0)),
    },
    commonPatterns,
    differentiationOpportunities,
    recommendedStructure: [
      "날짜와 핵심 변수를 포함한 제목",
      "300자 안팎의 핵심 요약 도입부",
      "한국 시장·미국 시장·금리·환율·수급을 분리한 소제목",
      "실제 데이터 기준일과 원문 URL",
      "서로 중복되지 않는 투자자 체크리스트",
      "투자 유의문구와 수동 최종 확인",
    ],
    copyrightPolicy: "경쟁 글의 본문 문장은 저장·복사하지 않고 구조 지표와 자체 요약만 사용합니다.",
  };
}
