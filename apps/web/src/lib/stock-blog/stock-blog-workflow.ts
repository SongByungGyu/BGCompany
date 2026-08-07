export type StockBlogContentType =
  | "KOREA_DAILY_PREVIEW"
  | "KOREA_MARKET_CLOSE_US_PREVIEW"
  | "WEEKLY_MARKET_REVIEW"
  | "NEXT_WEEK_MARKET_PREVIEW";

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
  { contentType: "KOREA_DAILY_PREVIEW", label: "전일 한국장 리뷰·오늘 한국장 전망", cadence: "평일", scheduledTimeKst: "07:20 KST 생성 시작 · 08:20 이전 발행 목표", objective: "전일 한국장을 짧게 복기하고 간밤 미국장 결과를 반영해 오늘 코스피 전망을 정리합니다.", primaryAudience: "한국 주식 투자자", recommendedRunnerMode: "hermes" },
  { contentType: "KOREA_MARKET_CLOSE_US_PREVIEW", label: "전일 미국장 리뷰·오늘 미국장 전망", cadence: "평일", scheduledTimeKst: "17:00 KST", objective: "전일 미국장을 짧게 복기하고 오늘 밤 미국장 관전 포인트를 정리합니다.", primaryAudience: "미국 주식 투자자", recommendedRunnerMode: "hermes" },
  { contentType: "WEEKLY_MARKET_REVIEW", label: "주간 시장 리뷰", cadence: "매주 토요일", scheduledTimeKst: "09:00 KST", objective: "한 주의 지수·섹터·수급 흐름을 정리합니다.", primaryAudience: "주간 복기와 다음 주 전략을 준비하는 투자자", recommendedRunnerMode: "hermes" },
  { contentType: "NEXT_WEEK_MARKET_PREVIEW", label: "다음 주 시장 프리뷰", cadence: "매주 토요일 또는 일요일", scheduledTimeKst: "09:00 KST", objective: "다음 주 주요 이벤트와 리스크 체크리스트를 준비합니다.", primaryAudience: "주말에 다음 주 투자 계획을 세우는 투자자", recommendedRunnerMode: "hermes" },
];

export function getStockBlogScheduleItems() { return STOCK_BLOG_SCHEDULE; }
export function getStockBlogScheduleItem(contentType: StockBlogContentType) { return STOCK_BLOG_SCHEDULE.find((item) => item.contentType === contentType) ?? STOCK_BLOG_SCHEDULE[0]; }
export function getExpectedHermesRunsForStockBlog(contentType: StockBlogContentType) {
  switch (contentType) {
    case "KOREA_DAILY_PREVIEW":
    case "KOREA_MARKET_CLOSE_US_PREVIEW":
    case "WEEKLY_MARKET_REVIEW":
    case "NEXT_WEEK_MARKET_PREVIEW":
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
      { id: "director-approval", label: "대표 승인", ownerTeam: "게시 운영팀", ownerAgentId: "director", expectedOutput: "게시 가능 여부 결정", requiresHermes: false },
      { id: "naver-draft", label: "네이버 임시저장 큐", ownerTeam: "게시 운영팀", ownerAgentId: "local-naver-draft-agent", expectedOutput: "로컬 브라우저 기반 네이버 임시저장", requiresHermes: false },
    ],
  };
}
