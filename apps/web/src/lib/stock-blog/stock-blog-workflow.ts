export type StockBlogContentType =
  | "KOREA_DAILY_PREVIEW"
  | "KOREA_MARKET_CLOSE_US_PREVIEW"
  | "WEEKLY_MARKET_REVIEW"
  | "NEXT_WEEK_MARKET_PREVIEW"
  | "INVESTMENT_STUDY"
  | "LARGE_CAP_DISCLOSURE_EARNINGS";

export type StockBlogScheduleItem = {
  contentType: StockBlogContentType;
  label: string;
  cadence: string;
  scheduledTimeKst: string;
  objective: string;
  primaryAudience: string;
  recommendedRunnerMode: "hermes" | "hermes-dry-run" | "mock";
};

export type StockBlogWorkflowStage = {
  id: string;
  label: string;
  ownerTeam: string;
  ownerAgentId: string;
  expectedOutput: string;
  requiresHermes: boolean;
};

export type StockBlogWorkflow = {
  contentType: StockBlogContentType;
  label: string;
  schedule: StockBlogScheduleItem;
  expectedHermesRuns: number;
  stages: StockBlogWorkflowStage[];
};

import { STOCK_BLOG_MAX_HERMES_RUNS } from "./qa-revision-policy";
export { STOCK_BLOG_MAX_HERMES_RUNS, STOCK_BLOG_MAX_QA_ATTEMPTS } from "./qa-revision-policy";

const STOCK_BLOG_SCHEDULE: StockBlogScheduleItem[] = [
  { contentType: "KOREA_DAILY_PREVIEW", label: "전일 한국장 리뷰·오늘 한국장 전망", cadence: "평일", scheduledTimeKst: "06:50 KST 준비 시작 · 08:20 KST 고정 공개", objective: "06:50부터 검증 자료를 준비하고 누락된 선택 항목은 제외해 08:20에 오늘 코스피 전망을 공개합니다.", primaryAudience: "한국 주식 투자자", recommendedRunnerMode: "hermes" },
  { contentType: "KOREA_MARKET_CLOSE_US_PREVIEW", label: "전일 미국장 리뷰·오늘 미국장 전망", cadence: "평일", scheduledTimeKst: "17:00 KST", objective: "전일 미국장을 짧게 복기하고 오늘 밤 미국장 관전 포인트를 정리합니다.", primaryAudience: "미국 주식 투자자", recommendedRunnerMode: "hermes" },
  { contentType: "WEEKLY_MARKET_REVIEW", label: "이번 주 한국·미국 시장 복기", cadence: "매주 토요일", scheduledTimeKst: "09:00 KST", objective: "이번 주 지수·수급·주도 업종과 변동 원인을 중심으로 복기합니다.", primaryAudience: "토요일에 한 주의 시장 흐름을 복기하는 투자자", recommendedRunnerMode: "hermes" },
  { contentType: "INVESTMENT_STUDY", label: "일정·결과·실전 질문 투자 공부", cadence: "평일 화·목 고정 + 월·수·금 이슈 시 주 1회", scheduledTimeKst: "12:10 KST", objective: "화요일에는 이번 주 공식 일정과 발표시간, 목요일에는 발표 결과와 주가 반응을 설명하고 조용한 날에는 검색형 실전 질문에 답합니다.", primaryAudience: "경제 일정과 실제 주가 반응의 이유를 검색하는 투자자", recommendedRunnerMode: "hermes" },
  { contentType: "NEXT_WEEK_MARKET_PREVIEW", label: "주요 이슈·섹터와 다음 주 전망", cadence: "매주 일요일", scheduledTimeKst: "19:00 KST", objective: "다음 주 핵심 이슈와 영향을 받을 섹터, 경제·실적 일정과 대응 조건을 준비합니다.", primaryAudience: "일요일 저녁 다음 주 투자 계획을 세우는 투자자", recommendedRunnerMode: "hermes" },
  { contentType: "LARGE_CAP_DISCLOSURE_EARNINGS", label: "대형주 공시·실적 체크", cadence: "중요 공식 발표가 있는 평일", scheduledTimeKst: "18:30 KST 조건부 확인", objective: "국내외 대형주의 중요한 공식 공시와 실적 발표가 있는 날에만 핵심 숫자와 투자 영향을 분석합니다.", primaryAudience: "대형주 공시와 실적을 빠르게 이해하려는 투자자", recommendedRunnerMode: "hermes" },
];

export function getStockBlogScheduleItems() { return STOCK_BLOG_SCHEDULE; }
export function getStockBlogScheduleItem(contentType: StockBlogContentType) { return STOCK_BLOG_SCHEDULE.find((item) => item.contentType === contentType) ?? STOCK_BLOG_SCHEDULE[0]; }
export function getExpectedHermesRunsForStockBlog(contentType: StockBlogContentType) {
  switch (contentType) {
    case "KOREA_DAILY_PREVIEW":
    case "KOREA_MARKET_CLOSE_US_PREVIEW":
    case "WEEKLY_MARKET_REVIEW":
    case "NEXT_WEEK_MARKET_PREVIEW":
    case "INVESTMENT_STUDY":
    case "LARGE_CAP_DISCLOSURE_EARNINGS":
      return STOCK_BLOG_MAX_HERMES_RUNS;
  }
}

export function getStockBlogWorkflow(contentType: StockBlogContentType): StockBlogWorkflow {
  const schedule = getStockBlogScheduleItem(contentType);
  return {
    contentType,
    label: schedule.label,
    schedule,
    expectedHermesRuns: getExpectedHermesRunsForStockBlog(contentType),
    stages: [
      { id: "market-analysis", label: "시장 분석 리포트 구성", ownerTeam: "주식 분석팀", ownerAgentId: "stock-monitor", expectedOutput: "지수·섹터·뉴스·리스크 체크포인트", requiresHermes: false },
      { id: "content-planning", label: "블로그 기획", ownerTeam: "블로그 운영팀", ownerAgentId: "content-planner", expectedOutput: "글 구조, 독자 관점, 핵심 메시지", requiresHermes: true },
      { id: "marketing-review", label: "제목·SEO·썸네일 검토", ownerTeam: "블로그 운영팀", ownerAgentId: "marketing-manager", expectedOutput: "제목 후보, 태그, 썸네일 문구", requiresHermes: true },
      { id: "writing", label: "게시용 본문 작성", ownerTeam: "블로그 운영팀", ownerAgentId: "content-writer", expectedOutput: "네이버 블로그 붙여넣기용 본문 초안", requiresHermes: true },
      { id: "qa-audit", label: "투자 유의·품질 검수", ownerTeam: "QA/감사팀", ownerAgentId: "qa-auditor", expectedOutput: "사실성, 과장 표현, 투자 유의문구 검토", requiresHermes: true },
      { id: "director-approval", label: "정책 승인·CEO 예외 분류", ownerTeam: "게시 운영팀", ownerAgentId: "director", expectedOutput: "정책 내 자동 승인 또는 CEO 예외 승인 요청", requiresHermes: false },
      { id: "naver-draft", label: "네이버 임시저장 큐", ownerTeam: "게시 운영팀", ownerAgentId: "local-naver-draft-agent", expectedOutput: "로컬 브라우저 기반 네이버 임시저장", requiresHermes: false },
    ],
  };
}
