import type {
  CompetitorBlogAnalysisSummary,
  StockReferenceBriefingTemplate,
} from "@/lib/stock-blog/references/reference-types";
import {
  getStockBlogEditorialGuidelines,
  getStockBlogEditorialPolicy,
  inspectStockBlogEditorialContract,
} from "@/lib/stock-blog/stock-blog-editorial-policy";
import { STOCK_BLOG_EDITORIAL_QUALITY_TARGET } from "@/lib/stock-blog/stock-blog-quality-target";

export { STOCK_BLOG_EDITORIAL_QUALITY_TARGET } from "@/lib/stock-blog/stock-blog-quality-target";

const SAFE_BASELINE_GUIDELINES = [
  "경쟁 글의 문장·비유·체크리스트를 복사하지 않고 구조 지표만 참고합니다.",
  "제목 앞부분에는 실제 검색어와 시장 판단을 두고 날짜는 시의성이 필요할 때 끝에 배치합니다.",
  "도입부는 30초 요약으로 시작해 판단·상방 조건·하방 조건·다음 확인 지표를 먼저 제시합니다.",
  "일일 본문은 공백 포함 1,800~2,800자, 주간 본문은 2,000~3,200자 안에서 문단 10개 이상으로 구성합니다.",
  "문단은 모바일에서 읽기 쉽도록 2~4문장으로 나누고 같은 어미와 상투적 표현을 반복하지 않습니다.",
  "검증된 시장 데이터와 실제 기사 출처를 사용하고 확인되지 않은 수치·일정은 만들지 않습니다.",
  "핵심 변수는 두 개, 투자자가 바로 확인할 항목은 세 개만 제공하고 투자 유의문구는 한 번만 표시합니다.",
  "대표 이미지 1장과 본문 이미지 2~3장을 관련 섹션에 배치하며 실제 수치가 있으면 차트를 우선합니다.",
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
  hasThirtySecondSummary: boolean;
  coreNumberCount: number;
  coreVariableCount: number;
  hasConditionalScenarios: boolean;
  beginnerExplanationSentenceCount: number;
  checklistItemCount: number;
  hasBgMarketNoteJudgment: boolean;
  hasForbiddenEngagementCta: boolean;
  forbiddenPhraseCount: number;
  excessiveBlankLineRunCount: number;
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
  version: 2;
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
  contentType?: StockReferenceBriefingTemplate;
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
  contentType?: StockReferenceBriefingTemplate;
}): OwnStockBlogStructure {
  const body = cleanBody(input.body);
  const contract = inspectStockBlogEditorialContract(
    input.body,
    input.contentType ?? "KOREA_DAILY_PREVIEW",
  );
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
    hasChecklist: contract.checklistItemCount > 0,
    hasSourceSection: /함께\s*확인한\s*기사|참고\s*자료|출처\s*[:：]?/i.test(body),
    hasDisclaimer: /투자\s*(?:판단|책임)|매수[·ㆍ\s-]*매도\s*(?:권유|추천)|투자\s*참고/i.test(body),
    hasThirtySecondSummary: contract.hasThirtySecondSummary,
    coreNumberCount: contract.coreNumberCount,
    coreVariableCount: contract.coreVariableCount,
    hasConditionalScenarios: contract.hasConditionalScenarios,
    beginnerExplanationSentenceCount: contract.beginnerExplanationSentenceCount,
    checklistItemCount: contract.checklistItemCount,
    hasBgMarketNoteJudgment: contract.hasBgMarketNoteJudgment,
    hasForbiddenEngagementCta: contract.hasForbiddenEngagementCta,
    forbiddenPhraseCount: contract.forbiddenPhraseMatches.length,
    excessiveBlankLineRunCount: contract.excessiveBlankLineRunCount,
  };
}

export function assessStockBlogEditorialQuality(input: QualityAssessmentInput): StockBlogEditorialQualityAssessment {
  const policy = getStockBlogEditorialPolicy(input.contentType ?? "KOREA_DAILY_PREVIEW");
  const failedChecks: string[] = [];
  let structure = 0;
  let evidence = 0;
  let readerValue = 0;

  if (input.structure.bodyLength >= policy.bodyLength.min && input.structure.bodyLength <= policy.bodyLength.max) structure += 8;
  else failedChecks.push(`본문 분량 ${policy.bodyLength.min.toLocaleString("ko-KR")}~${policy.bodyLength.max.toLocaleString("ko-KR")}자`);
  if (input.structure.headingCount >= policy.minimumHeadingCount) structure += 5;
  else failedChecks.push(`소제목 ${policy.minimumHeadingCount}개 이상`);
  if (input.structure.paragraphCount >= policy.minimumParagraphCount) structure += 4;
  else failedChecks.push(`문단 ${policy.minimumParagraphCount}개 이상`);
  if (input.structure.averageParagraphLength >= 35 && input.structure.averageParagraphLength <= 260) structure += 4;
  else failedChecks.push("모바일 가독성 문단 길이");
  if (input.structure.hasThirtySecondSummary) structure += 4;
  else failedChecks.push("30초 요약 4줄");
  if (input.structure.coreNumberCount >= policy.coreNumberMin && input.structure.coreNumberCount <= policy.coreNumberMax) structure += 3;
  else failedChecks.push(`핵심 숫자 ${policy.coreNumberMin}~${policy.coreNumberMax}개`);
  if (input.structure.coreVariableCount === 2) structure += 3;
  else failedChecks.push("핵심 변수 정확히 2개");
  if (input.structure.hasConditionalScenarios) structure += 2;
  else failedChecks.push("상승·하락 조건별 시나리오");
  if (input.structure.beginnerExplanationSentenceCount >= 3 && input.structure.beginnerExplanationSentenceCount <= 5) structure += 2;
  else failedChecks.push("초보자 설명 3~5문장");

  if (input.verifiedMarketSnapshot) evidence += 10;
  else failedChecks.push("검증된 최신 시장 데이터");
  if (input.realReferenceCount >= 5) evidence += 8;
  else failedChecks.push("실제 참고자료 5개 이상");
  if (input.publisherCount >= 3) evidence += 4;
  else failedChecks.push("서로 다른 발행처 3곳 이상");
  if (input.structure.hasSourceSection) evidence += 3;
  else failedChecks.push("출처·기사 확인 섹션");

  if (input.structure.hasChecklist && input.structure.checklistItemCount === policy.checklistItemCount) readerValue += 5;
  else failedChecks.push(`실행 가능한 확인 항목 정확히 ${policy.checklistItemCount}개`);
  if (input.structure.imageCount >= policy.totalImageMin && input.structure.imageCount <= policy.totalImageMax) readerValue += 4;
  else failedChecks.push(`대표·본문 이미지 총 ${policy.totalImageMin}~${policy.totalImageMax}장`);
  if (input.structure.hasDisclaimer) readerValue += 4;
  else failedChecks.push("투자 유의문구");
  if (input.structure.hasBgMarketNoteJudgment) readerValue += 4;
  else failedChecks.push("BG Market Note 판단");
  if (!input.structure.hasForbiddenEngagementCta && input.structure.forbiddenPhraseCount === 0) readerValue += 2;
  else failedChecks.push("AI 상투어·참여 유도 CTA 제거");
  if (input.structure.excessiveBlankLineRunCount === 0) readerValue += 1;
  else failedChecks.push("연속 빈 문단 제거");

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
    contentType: input.contentType,
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
  if (own.hasChecklist && own.checklistItemCount === 3) strengths.push("실행 가능한 확인 항목 3개");
  if (own.imageCount >= 3 && own.imageCount <= 4) strengths.push("대표·본문 이미지 수 기준 충족");
  if (analyzedCount > 0 && own.headingCount >= averages.headingCount) strengths.push("경쟁군 평균 이상의 소제목 구성");

  const improvementCandidates = [...quality.failedChecks];
  if (analyzedCount > 0 && own.paragraphCount < averages.paragraphCount) improvementCandidates.push("경쟁군보다 긴 문단을 더 짧게 분리");
  if (analyzedCount > 0 && own.imageCount < averages.imageCount) improvementCandidates.push("내용과 직접 연결되는 차트·이미지 보강");
  if (analyzedCount < 1) improvementCandidates.push("동일 유형 경쟁 블로그 심층 구조 표본 1개 이상 확보");

  return {
    version: 2,
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
    appliedGuidelines: Array.from(new Set(input.appliedGuidelines ?? [
      ...SAFE_BASELINE_GUIDELINES,
      ...getStockBlogEditorialGuidelines(input.contentType ?? "KOREA_DAILY_PREVIEW"),
    ])).slice(0, 16),
    copyrightPolicy: input.competitorAnalysis?.copyrightPolicy
      ?? "경쟁 글의 본문 문장은 저장·복사하지 않고 구조 지표와 자체 비교 결과만 사용합니다.",
  };
}
