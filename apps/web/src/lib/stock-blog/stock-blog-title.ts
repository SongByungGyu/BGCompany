import type { StockBriefingTemplate } from "@/features/content-pipeline/content-pipeline-types";

const DEFAULT_HOOKS: Record<StockBriefingTemplate, string> = {
  KOREA_DAILY_PREVIEW: "금리·환율·수급 체크",
  KOREA_MARKET_CLOSE_US_PREVIEW: "금리·선물·실적 체크",
  WEEKLY_MARKET_REVIEW: "수급·섹터 변화 점검",
  NEXT_WEEK_MARKET_PREVIEW: "주요 이슈·영향 섹터 체크",
  INVESTMENT_STUDY: "숫자와 사례로 이해",
  LARGE_CAP_DISCLOSURE_EARNINGS: "공식 발표 핵심 숫자",
};

const PROHIBITED_TITLE_EXPRESSIONS = ["급등 확정", "무조건 상승", "매수 추천", "수익 보장", "상한가 확정", "폭등", "몰빵"];
const MARKET_TITLE_PATTERN = /(?:증시|시장|한국장|미국장|코스피|코스닥|나스닥|S&P\s*500)/i;
const INVESTMENT_STUDY_TITLE_PATTERN = /(?:PER|PBR|ROE|현금흐름|배당기준일|배당락|금리|FOMC|PPI|CPI|고용지표|소매판매|GDP|발표시간|발표일|휴장|물가|환율|원달러|반도체|실적|가이던스|자사주|유상증자|무상증자|권리락|신주인수권|유가|외국인|기관|수급|ETF|영업레버리지|재고자산)/i;
const LEADING_DATE_PATTERN = /^(?:(?:20)?\d{2}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}\/\d{1,2}|20\d{2}년\s*\d{1,2}월\s*\d{1,2}일)\s*/;
const TRAILING_DATE_PATTERN = /(?:\s*[|｜·\-–—]?\s*(?:(?:20\d{2}년\s*)?\d{1,2}월\s*\d{1,2}일(?:\s*기준)?|\d{1,2}월\s*\d{1,2}주차))+\s*$/;
const TITLE_GENERIC_TOKENS = new Set([
  "오늘",
  "이번",
  "다음",
  "한국",
  "미국",
  "증시",
  "시장",
  "주식",
  "전망",
  "정리",
  "브리핑",
  "핵심",
  "변수",
  "기준",
  "주차",
]);

const TEMPLATE_INTENT_TERMS: Record<StockBriefingTemplate, string[]> = {
  KOREA_DAILY_PREVIEW: ["오늘", "한국장", "코스피", "장전", "환율", "수급"],
  KOREA_MARKET_CLOSE_US_PREVIEW: ["오늘", "미국장", "나스닥", "S&P500", "금리", "선물", "실적"],
  WEEKLY_MARKET_REVIEW: ["주간", "이번 주", "코스피", "나스닥", "수급", "주도 업종", "변화"],
  NEXT_WEEK_MARKET_PREVIEW: ["다음 주", "주요 이슈", "섹터", "일정", "실적", "경제지표"],
  INVESTMENT_STUDY: ["투자 공부", "주식 기초", "재무제표", "PER", "현금흐름", "배당", "코스피", "나스닥", "CPI", "PPI", "FOMC", "발표시간", "금리", "물가", "반도체", "실적", "유상증자", "무상증자", "권리락", "신주인수권"],
  LARGE_CAP_DISCLOSURE_EARNINGS: ["공시", "실적", "대형주", "매출", "영업이익", "가이던스"],
};

function removeProhibitedExpressions(value: string) {
  let result = value;
  for (const expression of PROHIBITED_TITLE_EXPRESSIONS) result = result.replaceAll(expression, "핵심 변수");
  return result.replace(/\s+/g, " ").trim();
}

function parseDateParts(value?: string) {
  const source = value?.trim() ?? "";
  const match = source.match(/^(?:20)?(\d{2})[-/.](\d{1,2})[-/.](\d{1,2})/)
    ?? source.match(/^20(\d{2})년\s*(\d{1,2})월\s*(\d{1,2})일/);
  if (match) {
    return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
  }
  const now = new Date();
  return { year: now.getFullYear() % 100, month: now.getMonth() + 1, day: now.getDate() };
}

function baseTitle(template: StockBriefingTemplate) {
  if (template === "KOREA_DAILY_PREVIEW") return "오늘 한국장 전망";
  if (template === "KOREA_MARKET_CLOSE_US_PREVIEW") return "오늘 미국장 전망";
  if (template === "WEEKLY_MARKET_REVIEW") return "한국·미국 주간 시장 정리";
  if (template === "INVESTMENT_STUDY") return "주식 투자 공부";
  if (template === "LARGE_CAP_DISCLOSURE_EARNINGS") return "대형주 공시·실적 분석";
  return "다음 주 증시 전망";
}

function dateSuffix(template: StockBriefingTemplate, marketDate?: string) {
  const { month, day } = parseDateParts(marketDate);
  if (template === "WEEKLY_MARKET_REVIEW") return `${month}월 ${Math.ceil(day / 7)}주차`;
  if (template === "NEXT_WEEK_MARKET_PREVIEW" || template === "INVESTMENT_STUDY" || template === "LARGE_CAP_DISCLOSURE_EARNINGS") return `${month}월 ${day}일 기준`;
  return `${month}월 ${day}일`;
}

function stripDecorativeDate(value: string) {
  return value
    .replace(LEADING_DATE_PATTERN, "")
    .replace(TRAILING_DATE_PATTERN, "")
    .replace(/^[|｜·:\-–—]+\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function comparisonTokens(value: string) {
  return new Set(stripDecorativeDate(value)
    .toLocaleLowerCase("ko-KR")
    .split(/[^0-9a-z가-힣]+/i)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2 && !TITLE_GENERIC_TOKENS.has(token)));
}

function jaccardSimilarity(left: Set<string>, right: Set<string>) {
  if (left.size === 0 || right.size === 0) return 0;
  const intersection = [...left].filter((token) => right.has(token)).length;
  return intersection / (left.size + right.size - intersection);
}

function scoreTitle(input: {
  title: string;
  template: StockBriefingTemplate;
  recentTitles: string[];
}) {
  const core = stripDecorativeDate(input.title);
  const tokens = comparisonTokens(core);
  const intentMatches = TEMPLATE_INTENT_TERMS[input.template].filter((term) => core.includes(term)).length;
  const specificitySignals = (core.match(/\d+(?:\.\d+)?%?|원달러|외국인|기관|환율|금리|실적|수급|반도체|코스피|코스닥|나스닥/g) ?? []).length;
  const strongestRecentSimilarity = input.recentTitles.reduce((max, recentTitle) => (
    Math.max(max, jaccardSimilarity(tokens, comparisonTokens(recentTitle)))
  ), 0);
  const lengthPenalty = core.length < 18 ? 12 : core.length > 62 ? 8 : 0;
  const duplicatePenalty = strongestRecentSimilarity >= 0.8 ? 70 : strongestRecentSimilarity * 35;
  const genericStudyPenalty = input.template === "INVESTMENT_STUDY"
    && core.includes("주식 투자 공부")
    && core.includes("주식 기초 공부")
    ? 15
    : 0;
  return Math.round((50 + Math.min(18, intentMatches * 4) + Math.min(18, specificitySignals * 3) - lengthPenalty - duplicatePenalty - genericStudyPenalty) * 10) / 10;
}

function withDateSuffix(value: string, suffix: string) {
  const cleanValue = value.replace(/[|｜·:\-–—\s]+$/, "").trim();
  const maxCoreLength = Math.max(20, 78 - suffix.length - 3);
  const core = cleanValue.length > maxCoreLength
    ? `${cleanValue.slice(0, maxCoreLength - 1).trim()}…`
    : cleanValue;
  return `${core}｜${suffix}`;
}

function cleanHook(value: string | undefined, template: StockBriefingTemplate) {
  let result = stripDecorativeDate(value ?? "")
    .replace(/\d{1,2}월\s*\d{1,2}주차\s*/, "")
    .replace(/오늘의?\s*(한국|미국)?\s*증시\s*/, "")
    .replace(/오늘의?\s*(한국장|미국장)\s*(전망|체크)?/g, "")
    .replace(/이번\s*주\s*(한국·미국|한국|미국)?\s*증시\s*(주간\s*)?(정리|리뷰)?/g, "")
    .replace(/다음\s*주\s*증시\s*(일정과\s*체크포인트|전망|체크)?/g, "")
    .replace(/한국장\s*마감\s*정리와\s*미국장\s*전망/g, "")
    .replace(/[|:·\-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  result = removeProhibitedExpressions(result);
  if (result.length < 6) result = DEFAULT_HOOKS[template];
  return result.length > 30 ? `${result.slice(0, 29)}…` : result;
}

export function buildStockBlogEditorialTitle(input: {
  template: StockBriefingTemplate;
  marketDate?: string;
  sourceTitle?: string;
}) {
  const sourceTitle = stripDecorativeDate(removeProhibitedExpressions(input.sourceTitle?.trim() ?? ""));
  const suffix = dateSuffix(input.template, input.marketDate);
  const preservesSearchIntent = MARKET_TITLE_PATTERN.test(sourceTitle)
    || (input.template === "INVESTMENT_STUDY" && INVESTMENT_STUDY_TITLE_PATTERN.test(sourceTitle));
  if (sourceTitle.length >= 15 && preservesSearchIntent) return withDateSuffix(sourceTitle, suffix);
  const prefix = baseTitle(input.template);
  return withDateSuffix(`${prefix}｜${cleanHook(sourceTitle, input.template)}`, suffix);
}

export type StockBlogTitleCandidateScore = {
  title: string;
  score: number;
};

export function selectBestStockBlogEditorialTitle(input: {
  template: StockBriefingTemplate;
  marketDate?: string;
  candidates: Array<string | null | undefined>;
  recentTitles?: string[];
}) {
  const recentTitles = input.recentTitles ?? [];
  const seen = new Set<string>();
  const candidates = input.candidates
    .map((sourceTitle) => buildStockBlogEditorialTitle({
      template: input.template,
      marketDate: input.marketDate,
      sourceTitle: sourceTitle ?? "",
    }))
    .filter((title) => {
      const key = title.toLocaleLowerCase("ko-KR").replace(/[\s|｜·:\-–—]+/g, "");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 3)
    .map((title) => ({
      title,
      score: scoreTitle({ title, template: input.template, recentTitles }),
    }))
    .sort((left, right) => right.score - left.score);

  const fallbackTitle = buildStockBlogEditorialTitle({
    template: input.template,
    marketDate: input.marketDate,
  });
  return {
    title: candidates[0]?.title ?? fallbackTitle,
    candidates,
  };
}
