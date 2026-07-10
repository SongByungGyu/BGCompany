import { getExpectedHermesRunsForStockBlog, getStockBlogScheduleItem, getStockBlogWorkflow, type StockBlogContentType } from "./stock-blog-workflow";

export type StockBlogTeamRole = {
  teamId: string;
  teamName: string;
  mission: string;
  agents: Array<{ employeeId: string; displayName: string; responsibility: string }>;
  outputs: string[];
};

export type StockBlogTeamTemplate = {
  contentType: StockBlogContentType;
  label: string;
  schedule: ReturnType<typeof getStockBlogScheduleItem>;
  expectedHermesRuns: number;
  teams: StockBlogTeamRole[];
  workflow: ReturnType<typeof getStockBlogWorkflow>;
};

export function getStockBlogTeamTemplate(contentType: StockBlogContentType): StockBlogTeamTemplate {
  const schedule = getStockBlogScheduleItem(contentType);
  return {
    contentType,
    label: schedule.label,
    schedule,
    expectedHermesRuns: getExpectedHermesRunsForStockBlog(contentType),
    teams: [
      { teamId: "stock-analysis", teamName: "주식 분석팀", mission: "외부 자동 수집 전까지 입력된 시장 맥락과 내부 mock context를 시장 리포트 구조로 정리합니다.", agents: [{ employeeId: "stock-monitor", displayName: "서준", responsibility: "지수·섹터·수급·리스크 체크포인트 정리" }], outputs: ["MarketAnalysisReport", "주요 체크포인트", "투자 유의 메모"] },
      { teamId: "blog-operations", teamName: "블로그 운영팀", mission: "시장 리포트를 네이버 블로그 독자가 읽기 쉬운 콘텐츠로 기획·마케팅·작성합니다.", agents: [{ employeeId: "content-planner", displayName: "미나", responsibility: "글 구조와 핵심 메시지 기획" }, { employeeId: "marketing-manager", displayName: "카이", responsibility: "제목·SEO·썸네일·태그 검토" }, { employeeId: "content-writer", displayName: "작가", responsibility: "게시용 본문 초안 작성" }], outputs: ["기획 결과", "마케팅 검토", "작성 초안", "네이버 게시 준비 데이터"] },
      { teamId: "qa-audit", teamName: "QA/감사팀", mission: "투자 조언 오해 가능성, 과장 표현, 누락된 유의문구를 검수합니다.", agents: [{ employeeId: "qa-auditor", displayName: "윤아", responsibility: "사실성·품질·투자 유의문구 최종 점검" }], outputs: ["QA 검수 결과", "수정 권고", "게시 리스크 판단"] },
      { teamId: "publishing-operations", teamName: "게시 운영팀", mission: "승인된 콘텐츠를 로컬 네이버 Draft Agent가 임시저장 큐로 넘기고, 최종 발행은 사용자가 직접 수행합니다.", agents: [{ employeeId: "director", displayName: "루나", responsibility: "최종 승인" }, { employeeId: "local-naver-draft-agent", displayName: "로컬 게시 에이전트", responsibility: "네이버 블로그 임시저장" }], outputs: ["Director 승인", "NaverDraftJob", "수동 발행 체크리스트"] },
    ],
    workflow: getStockBlogWorkflow(contentType),
  };
}

export { getExpectedHermesRunsForStockBlog, type StockBlogContentType };
