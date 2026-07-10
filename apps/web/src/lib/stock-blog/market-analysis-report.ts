import type { StockBlogContentType } from "./stock-blog-workflow";

export type MarketAnalysisReport = {
  id: string;
  contentType: StockBlogContentType;
  title: string;
  generatedAt: string;
  marketScope: "KR" | "US" | "KR_US";
  summary: string;
  indexSnapshot: string[];
  sectorFlow: string[];
  keyNews: string[];
  riskFactors: string[];
  investorChecklist: string[];
  disclaimer: string;
  sourceMode: "mock" | "manual" | "external-ready";
};

export type MarketAnalysisReportInput = { contentType: StockBlogContentType; title?: string; topic?: string; now?: Date; referenceNotes?: string[] };

const INVESTMENT_DISCLAIMER = "본 리포트는 투자 참고용 정보이며 특정 종목의 매수·매도 추천이 아닙니다. 모든 투자 판단과 책임은 투자자 본인에게 있습니다.";

function getMarketScope(contentType: StockBlogContentType): MarketAnalysisReport["marketScope"] {
  if (contentType === "KOREA_MARKET_CLOSE_US_PREVIEW" || contentType === "NEXT_WEEK_MARKET_PREVIEW") return "KR_US";
  return "KR";
}

export function buildMarketAnalysisReportFromMockContext(input: MarketAnalysisReportInput): MarketAnalysisReport {
  const now = input.now ?? new Date();
  const topic = input.topic?.trim() || "오늘의 주식시장 브리핑";
  const title = input.title?.trim() || topic;
  const referenceNotes = input.referenceNotes?.filter(Boolean) ?? [];
  return {
    id: `market-analysis-${now.getTime()}`,
    contentType: input.contentType,
    title,
    generatedAt: now.toISOString(),
    marketScope: getMarketScope(input.contentType),
    summary: `${topic}을 네이버 블로그 수동 게시용 브리핑으로 정리하기 위한 1차 시장 분석 리포트입니다.`,
    indexSnapshot: ["코스피·코스닥 방향성은 실제 데이터 연동 전까지 수동 입력 또는 mock context 기준으로 점검합니다.", "미국 선물·환율·금리 흐름은 향후 외부 데이터 연동 시 자동 보강합니다."],
    sectorFlow: ["반도체·2차전지·인터넷·금융 등 주요 섹터를 템플릿 체크리스트로 확인합니다.", "강세/약세 섹터는 자동 추천이 아니라 콘텐츠 작성을 위한 관찰 항목으로만 사용합니다."],
    keyNews: referenceNotes.length > 0 ? referenceNotes : ["실제 뉴스 API 호출 없이 사용자가 제공한 참고 메모와 내부 템플릿을 우선 사용합니다.", "외부 뉴스/시세 연동은 별도 승인 후 Phase 1-S 후속 단계에서 진행합니다."],
    riskFactors: ["단기 변동성 확대 가능성", "해외 금리·환율·정책 이벤트", "특정 종목 추천으로 오해될 수 있는 표현"],
    investorChecklist: ["지수 방향보다 리스크 관리 관점으로 읽기", "개별 종목 매수·매도 판단은 별도 검토하기", "본문 하단 투자 유의문구 포함 여부 확인하기"],
    disclaimer: INVESTMENT_DISCLAIMER,
    sourceMode: referenceNotes.length > 0 ? "manual" : "mock",
  };
}
