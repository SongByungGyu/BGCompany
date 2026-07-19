import type {
  CompetitorBlogAnalysisSummary,
  StockReferenceBriefingTemplate,
} from "@/lib/stock-blog/references/reference-types";

export const STOCK_BLOG_EDITORIAL_QUALITY_TARGET = 90;

const SAFE_BASELINE_GUIDELINES = [
  "경쟁 글의 문장·비유·체크리스트를 복사하지 않고 구조 지표만 참고합니다.",
  "제목에는 기준 날짜와 한국·미국 시장의 핵심 변수를 자연스럽게 포함합니다.",
  "도입부는 최근 시장 움직임을 독자에게 설명하듯 시작하고 80~350자 안에서 핵심 흐름을 제시합니다.",
  "본문은 공백 포함 2,000~3,200자, 소제목 6개 이상, 문단 10개 이상으로 구성합니다.",
  "문단은 모바일에서 읽기 쉽도록 2~4문장으로 나누고 같은 어미와 상투적 표현을 반복하지 않습니다.",
  "검증된 시장 데이터와 실제 기사 출처를 사용하고 확인되지 않은 수치·일정은 만들지 않습니다.",
  "투자자가 바로 점검할 수 있는 체크리스트를 4~6개 제공하고 투자 유의문구는 한 번만 표시합니다.",
  "대표 이미지 1장과 본문 이미지 2~4장을 관련 섹션에 배치하며 실제 수치가 있으면 차트를 우선합니다.",
] as const;

export type OwnStockBlogStructure = {
  titleLength: number;
  bodyLength: number;
  introLength: number;
  paragraphCount: number;
  headingCount: number;
  imageCount: number;
  bulletItemCount: number;
  averageParagraphLength: number;
  hasDateInTitle: boolean;
  hasChecklist: boolean;
  hasSourceSection: boolean;
  hasDisclaimer: boolean;
};

export type StockBlogEditorialQualityAssessment = {
  score: number;
  target: number;
  passed: boolean;
  dimensions: {
    structure: number;
    evidence: number;
    readerValue: number;
    qa: number;
  };
  failedChecks: string[];
};

export type StockBlogEditorialBenchmark = {
  version: 1;
  generatedAt: string;
  contentType?: StockReferenceBriefingTemplate;
  quality: StockBlogEditorialQualityAssessment;
  own: OwnStockBlogStructure;
  competitor: {
    requestedCount: number;
    analyzedCount: number;
    failedCount: number;
    averages: CompetitorBlogAnalysisSummary["averages"];
  };
  deltas: {
    bodyLength: number;
    paragraphCount: number;
    headingCount: number;
    imageCount: number;
  };
  strengths: string[];
  improvementCandidates: string[];
  appliedGuidelines: string[];
  copyrightPolicy: string;
};

type QualityAssessmentInput = {
  structure: OwnStockBlogStructure;
  realReferenceCount: number;
  publisherCount: number;
  verifiedMarketSnapshot: boolean;
  qaScore?: number;
};

function cleanBody(value: string) {
  return value
    .replace(/[#>*_`~|]/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\r\n/g, "\n")
    .trim();
}

function countHeadings(body: string) {
  return body.split("\n").filter((line) => {
    const value = line.trim();
    if (!value) return false;
    return /^#{1,4}\s+/.test(value)
      || /^\d+\.\s+\S+/.test(value)
      || /^(?:함께 확인한 기사|마무리|기회 요인|위험 요인)$/.test(value);
  }).length;
}

function countBullets(body: string) {
  return body.split("\n").filter((line) => /^\s*[-*•]\s+/.test(line)).length;
}

export function inspectOwnStockBlogStructure(input: {
  title: string;
  body: string;
  imageCount?: number;
}): OwnStockBlogStructure {
  const body = cleanBody(input.body);
  const paragraphs = body
    .split(/\n{2,}/)
    .map((part) => part.replace(/\s+/g, " ").trim())
    .filter((part) => part.length >= 20 && !/^https?:\/\//.test(part));
  const proseParagraphs = paragraphs.filter((part) => !/^\d+\.\s+\S+/.test(part) && !/^(?:함께 확인한 기사|마무리)$/.test(part));
  const bodyLength = body.length;
  return {
    titleLength: input.title.replace(/\s/g, "").length,
    bodyLength,
    introLength: proseParagraphs[0]?.length ?? Math.min(bodyLength, 350),
    paragraphCount: paragraphs.length,
    headingCount: countHeadings(input.body),
    imageCount: Math.max(0, input.imageCount ?? 0),
    bulletItemCount: countBullets(input.body),
    averageParagraphLength: proseParagraphs.length > 0
      ? Math.round(proseParagraphs.reduce((sum, paragraph) => sum + paragraph.length, 0) / proseParagraphs.length)
      : 0,
    hasDateInTitle: /(?:20\d{2}[./-]\d{1,2}[./-]\d{1,2}|20\d{2}년|\d{1,2}월\s*\d{1,2}일)/.test(input.title),
    hasChecklist: /체크\s*(?:리스트|포인트)|확인할\s*(?:사항|항목)|점검할\s*(?:사항|항목)/i.test(body) || countBullets(input.body) >= 4,
    hasSourceSection: /함께\s*확인한\s*기사|참고\s*자료|출처\s*[:：]?/i.test(body),
    hasDisclaimer: /투자\s*(?:판단|책임)|매수[·ㆍ\s-]*매도\s*(?:권유|추천)|투자\s*참고/i.test(body),
  };
}

export function assessStockBlogEditorialQuality(input: QualityAssessmentInput): StockBlogEditorialQualityAssessment {
  const failedChecks: string[] = [];
  let structure = 0;
  let evidence = 0;
  let readerValue = 0;

  if (input.structure.bodyLength >= 2_000 && input.structure.bodyLength <= 3_200) structure += 10;
  else failedChecks.push("본문 분량 2,000~3,200자");
  if (input.structure.headingCount >= 6) structure += 8;
  else failedChecks.push("소제목 6개 이상");
  if (input.structure.paragraphCount >= 10) structure += 7;
  else failedChecks.push("문단 10개 이상");
  if (input.structure.averageParagraphLength >= 45 && input.structure.averageParagraphLength <= 260) structure += 5;
  else failedChecks.push("모바일 가독성 문단 길이");
  if (input.structure.introLength >= 80 && input.structure.introLength <= 350) structure += 5;
  else failedChecks.push("도입부 80~350자");

  if (input.verifiedMarketSnapshot) evidence += 10;
  else failedChecks.push("검증된 최신 시장 데이터");
  if (input.realReferenceCount >= 5) evidence += 8;
  else failedChecks.push("실제 참고자료 5개 이상");
  if (input.publisherCount >= 3) evidence += 4;
  else failedChecks.push("서로 다른 발행처 3곳 이상");
  if (input.structure.hasSourceSection) evidence += 3;
  else failedChecks.push("출처·기사 확인 섹션");

  if (input.structure.hasChecklist && input.structure.bulletItemCount >= 4) readerValue += 6;
  else failedChecks.push("실행 가능한 체크리스트 4개 이상");
  if (input.structure.imageCount >= 3 && input.structure.imageCount <= 5) readerValue += 5;
  else failedChecks.push("대표·본문 이미지 총 3~5장");
  if (input.structure.hasDisclaimer) readerValue += 5;
  else failedChecks.push("투자 유의문구");
  if (input.structure.hasDateInTitle) readerValue += 2;
  if (input.structure.paragraphCount >= 12) readerValue += 2;

  const normalizedQaScore = typeof input.qaScore === "number" && Number.isFinite(input.qaScore)
    ? Math.max(0, Math.min(100, input.qaScore))
    : 0;
  const qa = Math.round(normalizedQaScore * 0.2);
  if (normalizedQaScore < STOCK_BLOG_EDITORIAL_QUALITY_TARGET) failedChecks.push(`Hermes QA ${STOCK_BLOG_EDITORIAL_QUALITY_TARGET}점 이상`);

  const score = Math.max(0, Math.min(100, structure + evidence + readerValue + qa));
  return {
    score,
    target: STOCK_BLOG_EDITORIAL_QUALITY_TARGET,
    passed: score >= STOCK_BLOG_EDITORIAL_QUALITY_TARGET && normalizedQaScore >= STOCK_BLOG_EDITORIAL_QUALITY_TARGET,
    dimensions: { structure, evidence, readerValue, qa },
    failedChecks: Array.from(new Set(failedChecks)),
  };
}

export function selectSafeEditorialBenchmarkGuidelines(analysis?: CompetitorBlogAnalysisSummary) {
  const selected: string[] = [...SAFE_BASELINE_GUIDELINES];
  if (analysis?.commonPatterns.some((item) => item.includes("날짜"))) selected.push("동일 유형의 경쟁 글에서 날짜형 제목이 반복되므로 기준 날짜를 제목 앞부분에 배치합니다.");
  if (analysis?.commonPatterns.some((item) => item.includes("이미지"))) selected.push("경쟁 글의 이미지 사용 패턴을 참고하되 검증 데이터 차트와 자체 제작 이미지만 사용합니다.");
  if (analysis?.differentiationOpportunities.some((item) => item.includes("출처"))) selected.push("경쟁 글과 구분되도록 실제 활용 기사 3개와 기준일을 명확히 표시합니다.");
  if (analysis?.differentiationOpportunities.some((item) => item.includes("체크리스트"))) selected.push("글의 결론과 중복되지 않는 개인 투자자 체크리스트를 제공합니다.");
  return Array.from(new Set(selected)).slice(0, 10);
}

export function buildStockBlogEditorialBenchmark(input: {
  generatedAt?: string;
  contentType?: StockReferenceBriefingTemplate;
  title: string;
  body: string;
  imageCount?: number;
  realReferenceCount: number;
  publisherCount: number;
  verifiedMarketSnapshot: boolean;
  qaScore?: number;
  competitorAnalysis?: CompetitorBlogAnalysisSummary;
  appliedGuidelines?: string[];
}): StockBlogEditorialBenchmark {
  const own = inspectOwnStockBlogStructure(input);
  const quality = assessStockBlogEditorialQuality({
    structure: own,
    realReferenceCount: input.realReferenceCount,
    publisherCount: input.publisherCount,
    verifiedMarketSnapshot: input.verifiedMarketSnapshot,
    qaScore: input.qaScore,
  });
  const averages = input.competitorAnalysis?.averages ?? {
    titleLength: 0,
    bodyLength: 0,
    introLength: 0,
    paragraphCount: 0,
    headingCount: 0,
    imageCount: 0,
    linkCount: 0,
  };
  const analyzedCount = input.competitorAnalysis?.analyzedCount ?? 0;
  const delta = (ownValue: number, competitorValue: number) => analyzedCount > 0 ? ownValue - competitorValue : 0;
  const strengths: string[] = [];
  if (own.hasSourceSection) strengths.push("실제 출처를 독자가 확인할 수 있는 구조");
  if (own.hasDisclaimer) strengths.push("투자 유의문구 포함");
  if (own.hasChecklist && own.bulletItemCount >= 4) strengths.push("실행 가능한 투자자 체크리스트");
  if (own.imageCount >= 3 && own.imageCount <= 5) strengths.push("대표·본문 이미지 수 기준 충족");
  if (analyzedCount > 0 && own.headingCount >= averages.headingCount) strengths.push("경쟁군 평균 이상의 소제목 구성");

  const improvementCandidates = [...quality.failedChecks];
  if (analyzedCount > 0 && own.paragraphCount < averages.paragraphCount) improvementCandidates.push("경쟁군보다 긴 문단을 더 짧게 분리");
  if (analyzedCount > 0 && own.imageCount < averages.imageCount) improvementCandidates.push("내용과 직접 연결되는 차트·이미지 보강");
  if (analyzedCount < 1) improvementCandidates.push("동일 유형 경쟁 블로그 심층 구조 표본 1개 이상 확보");

  return {
    version: 1,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    contentType: input.contentType,
    quality,
    own,
    competitor: {
      requestedCount: input.competitorAnalysis?.requestedCount ?? 0,
      analyzedCount,
      failedCount: input.competitorAnalysis?.failedCount ?? 0,
      averages,
    },
    deltas: {
      bodyLength: delta(own.bodyLength, averages.bodyLength),
      paragraphCount: delta(own.paragraphCount, averages.paragraphCount),
      headingCount: delta(own.headingCount, averages.headingCount),
      imageCount: delta(own.imageCount, averages.imageCount),
    },
    strengths,
    improvementCandidates: Array.from(new Set(improvementCandidates)),
    appliedGuidelines: Array.from(new Set(input.appliedGuidelines ?? SAFE_BASELINE_GUIDELINES)).slice(0, 10),
    copyrightPolicy: input.competitorAnalysis?.copyrightPolicy
      ?? "경쟁 글의 본문 문장은 저장·복사하지 않고 구조 지표와 자체 비교 결과만 사용합니다.",
  };
}
