import type {
  InvestmentStudyEditorialAngle,
  InvestmentStudyTopicSelection,
} from "./investment-study-topic";
import type { ReferenceItem } from "./references/reference-types";

export type InvestmentStudySearchCampaign = {
  selection: InvestmentStudyTopicSelection;
  referenceItems: ReferenceItem[];
};

const BLS_SEPTEMBER_2026_SCHEDULE_URL = "https://www.bls.gov/schedule/2026/09_sched_list.htm";
const BROADCOM_Q3_FY2026_RESULTS_URL = "https://investors.broadcom.com/news-releases/news-release-details/broadcom-inc-announces-third-quarter-fiscal-year-2026-financial";

function cpiCampaign(collectedAt: string): InvestmentStudySearchCampaign {
  return {
    selection: {
      mode: "search_question",
      title: "미국 CPI 발표시간은 언제? 예상보다 높으면 나스닥이 흔들리는 이유",
      topic: "미국 노동통계국 공식 일정에서 2026년 9월 CPI 발표가 미국 동부시간 9월 11일 오전 8시 30분, 한국시간 오후 9시 30분으로 예정된 사실을 확인합니다. 발표 전에는 실제값을 만들지 않고 예상치와 실제값을 구분하며, CPI가 미국 국채금리와 나스닥에 전달되는 과정과 발표 전후 확인 순서를 초보자도 이해할 수 있게 설명합니다.",
      score: 2,
      reasons: ["미국 노동통계국 공식 발표 일정에서 9월 11일 CPI 공개 시각을 확인했습니다."],
      keywords: ["미국 CPI 발표시간", "9월 CPI 발표", "미국 소비자물가", "나스닥 전망", "미국 국채금리", "CPI 예상치"],
    },
    referenceItems: [{
      id: "official-bls-september-2026-cpi-schedule",
      sourceType: "calendar",
      provider: "bls",
      title: "Schedule of Releases for September 2026",
      url: BLS_SEPTEMBER_2026_SCHEDULE_URL,
      originalUrl: BLS_SEPTEMBER_2026_SCHEDULE_URL,
      publisher: "U.S. Bureau of Labor Statistics",
      sourceName: "미국 노동통계국(BLS)",
      publishedAt: "2026-09-01",
      collectedAt,
      summary: "미국 노동통계국은 2026년 9월 소비자물가지수(CPI)를 9월 11일 오전 8시 30분(미국 동부시간)에 공개할 예정입니다. 발표 전이므로 실제 CPI 수치는 아직 확정되지 않았습니다.",
      keywords: ["미국 CPI 발표시간", "소비자물가지수", "BLS", "9월 11일"],
      relevanceScore: 1,
      usageNote: "발표 날짜와 시각은 공식 일정만 사용하고, 발표 전 실제값은 쓰지 않습니다.",
      copyrightPolicy: "공식 일정의 사실만 자체 문장으로 요약하고 원문 링크를 표시합니다.",
      contentType: "INVESTMENT_STUDY",
      market: "US",
      reliability: "official",
      facts: [{
        key: "bls.cpi.releaseAt.2026-09",
        label: "2026년 9월 CPI 발표 시각",
        value: "2026-09-11 08:30 ET · 한국시간 21:30",
        asOf: "2026-09-07",
        sourceName: "미국 노동통계국(BLS)",
        sourceUrl: BLS_SEPTEMBER_2026_SCHEDULE_URL,
      }],
    }],
  };
}

function broadcomCampaign(collectedAt: string): InvestmentStudySearchCampaign {
  return {
    selection: {
      mode: "market_issue",
      title: "브로드컴 실적 발표, 매출 296억달러보다 중요한 AI 반도체 가이던스",
      topic: "브로드컴 공식 2026회계연도 3분기 실적에서 매출 296억달러와 전년 동기 대비 86% 증가, 4분기 매출 가이던스 348억달러를 확인합니다. 확정 실적과 전망을 구분하고, AI 반도체 수요가 다음 분기 매출과 데이터센터 투자 흐름에 어떻게 연결되는지 설명합니다. 특정 시점의 브로드컴 주가 반응은 검증된 시장 자료가 있을 때만 사용합니다.",
      score: 5,
      reasons: ["브로드컴 공식 IR에서 2026회계연도 3분기 확정 실적과 4분기 매출 가이던스를 확인했습니다."],
      keywords: ["브로드컴 실적", "브로드컴 주가", "AVGO 실적", "AI 반도체", "브로드컴 가이던스", "데이터센터 반도체"],
    },
    referenceItems: [{
      id: "official-broadcom-q3-fy2026-results",
      sourceType: "company",
      provider: "broadcom-ir",
      title: "Broadcom Inc. Announces Third Quarter Fiscal Year 2026 Financial Results",
      url: BROADCOM_Q3_FY2026_RESULTS_URL,
      originalUrl: BROADCOM_Q3_FY2026_RESULTS_URL,
      publisher: "Broadcom Inc.",
      sourceName: "Broadcom Investor Relations",
      publishedAt: "2026-09-02",
      collectedAt,
      summary: "브로드컴의 2026회계연도 3분기 매출은 296억달러로 전년 동기 대비 86% 증가했습니다. 회사가 제시한 4분기 매출 가이던스는 약 348억달러입니다.",
      keywords: ["브로드컴 실적", "AVGO", "AI 반도체", "매출 가이던스"],
      relevanceScore: 1,
      usageNote: "확정 실적과 다음 분기 회사 가이던스를 구분해 사용합니다.",
      copyrightPolicy: "공식 발표의 사실과 수치만 자체 문장으로 요약하고 원문 링크를 표시합니다.",
      contentType: "INVESTMENT_STUDY",
      market: "US",
      symbols: ["AVGO"],
      reliability: "official",
      metrics: [
        { key: "broadcom.fy2026.q3.revenue", label: "3분기 매출", value: 29.6, unit: "십억달러", asOf: "2026-09-02", sourceName: "Broadcom Investor Relations", sourceUrl: BROADCOM_Q3_FY2026_RESULTS_URL },
        { key: "broadcom.fy2026.q3.revenueGrowth", label: "매출 증가율", value: 86, unit: "%", asOf: "2026-09-02", sourceName: "Broadcom Investor Relations", sourceUrl: BROADCOM_Q3_FY2026_RESULTS_URL },
        { key: "broadcom.fy2026.q4.revenueGuidance", label: "4분기 매출 가이던스", value: 34.8, unit: "십억달러", asOf: "2026-09-02", sourceName: "Broadcom Investor Relations", sourceUrl: BROADCOM_Q3_FY2026_RESULTS_URL },
      ],
    }],
  };
}

export function getInvestmentStudySearchCampaign(input: {
  marketDate: string;
  angle?: InvestmentStudyEditorialAngle;
  collectedAt: string;
}): InvestmentStudySearchCampaign | null {
  if (input.marketDate === "2026-09-07" && input.angle === "upcoming_question") {
    return cpiCampaign(input.collectedAt);
  }
  if (input.marketDate === "2026-09-07" && input.angle === "result_or_practical") {
    return broadcomCampaign(input.collectedAt);
  }
  return null;
}
