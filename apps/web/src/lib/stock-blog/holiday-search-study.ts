import type { StockMarketSession } from "./market-session-policy.ts";

export type HolidaySearchStudyPlan = {
  market: "KR" | "US";
  sourceTitle: string;
  topic: string;
  keywords: string[];
};

export function getHolidaySearchStudyPublishKey(marketDate: string) {
  return `INVESTMENT_STUDY_HOLIDAY:${marketDate}`;
}

export function buildHolidaySearchStudyPlan(input: {
  session: StockMarketSession;
  nextOpenDate?: string | null;
}): HolidaySearchStudyPlan | null {
  if (input.session.state !== "closed") return null;

  const nextOpenText = input.nextOpenDate
    ? `다음 정규 개장일은 ${input.nextOpenDate}로 확인됐습니다.`
    : "다음 정규 개장일은 공식 거래소 일정을 확인해 검증된 날짜만 적습니다.";
  const verifiedOnly = "휴장 사유와 거래 일정은 공식 거래소·증권사 자료로 검증하고, 확인되지 않은 개장 시각이나 주문 체결 가능 여부는 추정하지 않습니다.";

  if (input.session.market === "KRX") {
    return {
      market: "KR",
      sourceTitle: "오늘 국내 주식시장 휴장인가요? 다음 개장일과 주문 가능 여부",
      topic: `${input.session.marketDate} 국내 주식시장 휴장이 확인됐습니다. ${input.session.reason} ${nextOpenText} 휴장일 주문 접수와 실제 체결의 차이, 다음 거래일 개장시간, 휴장 전후 확인할 환율·미국장·공시 일정을 초보자도 이해할 수 있게 설명합니다. ${verifiedOnly}`,
      keywords: ["오늘 주식시장 휴장", "국장 휴장일", "코스피 휴장", "다음 개장일", "주식 주문 가능 여부"],
    };
  }

  return {
    market: "US",
    sourceTitle: "오늘 미국장 휴장인가요? 다음 개장일과 한국시간 거래시간",
    topic: `${input.session.marketDate} 미국 증시 휴장이 확인됐습니다. ${input.session.reason} ${nextOpenText} 정규장·프리마켓·애프터마켓 운영 여부와 다음 거래일 한국시간, 휴장 뒤 확인할 국채금리·선물·주요 경제일정을 초보자도 이해할 수 있게 설명합니다. ${verifiedOnly}`,
    keywords: ["오늘 미국장 휴장", "미국 증시 휴장일", "미국장 개장시간", "다음 개장일", "프리마켓 거래시간"],
  };
}
