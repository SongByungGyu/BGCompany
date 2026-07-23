import type { StockBriefingTemplate } from "@/features/content-pipeline/content-pipeline-types";

const DEFAULT_HOOKS: Record<StockBriefingTemplate, string> = {
  KOREA_DAILY_PREVIEW: "금리·환율·수급 체크",
  KOREA_MARKET_CLOSE_US_PREVIEW: "금리·선물·실적 체크",
  WEEKLY_MARKET_REVIEW: "수급·섹터 변화 점검",
  NEXT_WEEK_MARKET_PREVIEW: "경제지표·실적 일정 체크",
};

const PROHIBITED_TITLE_EXPRESSIONS = ["급등 확정", "무조건 상승", "매수 추천", "수익 보장", "상한가 확정", "폭등", "몰빵"];
const COMPLETE_EDITORIAL_TITLE_PATTERN = /(?:20\d{2}년\s*\d{1,2}월\s*\d{1,2}일|(?:20)?\d{2}[-/.]\d{1,2}[-/.]\d{1,2}).*(?:증시|시장)/;

function removeProhibitedExpressions(value: string) {
  let result = value;
  for (const expression of PROHIBITED_TITLE_EXPRESSIONS) result = result.replaceAll(expression, "핵심 변수");
  return result.replace(/\s+/g, " ").trim();
}

function parseDateParts(value?: string) {
  const source = value?.trim() ?? "";
  const match = source.match(/^(?:20)?(\d{2})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (match) {
    return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
  }
  const now = new Date();
  return { year: now.getFullYear() % 100, month: now.getMonth() + 1, day: now.getDate() };
}

function baseTitle(template: StockBriefingTemplate, marketDate?: string) {
  const { month, day } = parseDateParts(marketDate);
  if (template === "KOREA_DAILY_PREVIEW") return `${month}/${day} 오늘의 한국장 전망`;
  if (template === "KOREA_MARKET_CLOSE_US_PREVIEW") return `${month}/${day} 오늘의 미국장 전망`;
  if (template === "WEEKLY_MARKET_REVIEW") return `${month}월 ${Math.ceil(day / 7)}주차 한국·미국 주간 시장 정리`;
  return `${month}/${day} 다음 주 증시 전망`;
}

function cleanHook(value: string | undefined, template: StockBriefingTemplate) {
  let result = (value ?? "")
    .replace(/^(?:20)?\d{2}[-/.]\d{1,2}[-/.]\d{1,2}\s*/, "")
    .replace(/^\d{1,2}\/\d{1,2}\s*/, "")
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
  const sourceTitle = removeProhibitedExpressions(input.sourceTitle?.trim() ?? "");
  if (sourceTitle.length >= 15 && COMPLETE_EDITORIAL_TITLE_PATTERN.test(sourceTitle)) {
    return sourceTitle.length > 90 ? `${sourceTitle.slice(0, 89)}…` : sourceTitle;
  }
  const prefix = baseTitle(input.template, input.marketDate);
  return `${prefix} ${cleanHook(sourceTitle, input.template)}`;
}
