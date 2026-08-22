import type { StockBlogContentType } from "./stock-blog-workflow";

export type MarketDataFallbackStudyPlan = {
  sourceTitle: string;
  topic: string;
  keywords: string[];
};

const SEARCH_STUDY_ANGLES = [
  {
    title: "코스피는 올랐는데 내 종목은 왜 안 오를까? 지수 쏠림장 읽는 법",
    topic: "코스피 지수 상승과 개별 종목 수익률이 다른 이유를 시가총액 가중 방식, 대형주 쏠림, 상승 종목 수와 거래대금으로 설명합니다.",
    keywords: ["코스피 상승 내 종목 하락", "대형주 쏠림", "상승 종목 수", "시가총액 가중지수"],
  },
  {
    title: "외국인이 순매수했는데 주가는 왜 내릴까? 수급 숫자 읽는 순서",
    topic: "외국인 순매수 합계와 장중 체결, 선물·현물, 대형주 집중 매수의 차이를 설명하고 개인 투자자가 수급 숫자를 확인하는 순서를 정리합니다.",
    keywords: ["외국인 순매수 주가 하락", "기관 수급", "선물 현물", "주식 수급 보는 법"],
  },
  {
    title: "원달러 환율이 오르면 코스피는 왜 흔들릴까? 초보자 확인법",
    topic: "원달러 환율과 외국인 자금, 수출주·내수주, 미국 금리의 연결 관계를 설명하고 환율 움직임을 주식 투자에 적용할 때 확인할 항목을 정리합니다.",
    keywords: ["원달러 환율 코스피", "환율 오르면 주식", "외국인 자금", "미국 금리 영향"],
  },
  {
    title: "나스닥이 올랐는데 국내 성장주는 왜 약할까? 연결해서 보는 법",
    topic: "나스닥 등락을 국내 성장주에 그대로 대입하면 안 되는 이유를 환율, 국내 수급, 업종 구성, 실적 기대 차이로 설명합니다.",
    keywords: ["나스닥 상승 국내주식 하락", "성장주 금리", "코스닥 수급", "미국장 국내장 영향"],
  },
] as const;

export function getMarketDataFallbackStudyPublishKey(marketDate: string, publishTime: string) {
  return `INVESTMENT_STUDY_DATA_FALLBACK:${marketDate}:${publishTime}`;
}

export function buildMarketDataFallbackStudyPlan(input: {
  marketDate: string;
  sourceContentType: StockBlogContentType;
}): MarketDataFallbackStudyPlan {
  const day = Number.parseInt(input.marketDate.slice(-2), 10);
  const offset = input.sourceContentType === "WEEKLY_MARKET_REVIEW" ? 1 : 0;
  const angle = SEARCH_STUDY_ANGLES[(Number.isFinite(day) ? day + offset : offset) % SEARCH_STUDY_ANGLES.length];
  return {
    sourceTitle: angle.title,
    topic: `${angle.topic} 시장자료 제공이 지연된 항목은 수치와 그래프에서 제외하고, 확인 가능한 공식 자료와 기사만 근거로 사용합니다. 매수·매도 추천이 아니라 검색자가 바로 적용할 확인 순서를 중심으로 설명합니다.`,
    keywords: [...angle.keywords, "주식 투자 공부"],
  };
}
