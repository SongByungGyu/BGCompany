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
      { teamId: "stock-analysis", teamName: "주식 분석팀", mission: "공식 시장 데이터와 검증된 ReferenceBundle을 수집·정규화하고 Hermes 실행 전 품질을 검사합니다.", agents: [{ employeeId: "stock-monitor", displayName: "서준", responsibility: "지수·섹터·수급·리스크와 레퍼런스 품질 점검" }], outputs: ["MarketAnalysisReport", "ReferenceBundle", "주요 체크포인트", "투자 유의 메모"] },
      { teamId: "blog-operations", teamName: "블로그 운영팀", mission: "검증된 시장 데이터와 레퍼런스를 네이버 블로그 독자가 읽기 쉬운 콘텐츠로 기획·마케팅·작성합니다.", agents: [{ employeeId: "content-planner", displayName: "미나", responsibility: "글 구조와 레퍼런스 사용 계획 수립" }, { employeeId: "marketing-manager", displayName: "카이", responsibility: "제목·SEO·썸네일·차별화 검토" }, { employeeId: "content-writer", displayName: "지아", responsibility: "레퍼런스 근거를 반영한 게시용 본문 작성" }], outputs: ["기획 결과", "마케팅 검토", "작성 초안", "네이버 게시 준비 데이터"] },
      { teamId: "qa-audit", teamName: "QA/감사팀", mission: "투자 조언 오해 가능성, 과장 표현, 누락된 유의문구를 검수합니다.", agents: [{ employeeId: "qa-auditor", displayName: "윤아", responsibility: "사실성·품질·투자 유의문구 최종 점검" }], outputs: ["QA 검수 결과", "수정 권고", "게시 리스크 판단"] },
      { teamId: "publishing-operations", teamName: "게시 운영팀", mission: "품질 게이트를 통과한 콘텐츠를 정책에 따라 자동 게시하거나 임시저장·사용자 확인 단계로 전환합니다.", agents: [{ employeeId: "director", displayName: "루나", responsibility: "정책 게이트 적용과 CEO 예외 승인 요청" }, { employeeId: "local-naver-draft-agent", displayName: "로컬 게시 에이전트", responsibility: "네이버 임시저장과 이중 허용된 작업의 guarded publish" }], outputs: ["정책 승인 결과", "NaverDraftJob", "게시 또는 수동 확인 기록"] },
    ],
    workflow: getStockBlogWorkflow(contentType),
  };
}

export { getExpectedHermesRunsForStockBlog, type StockBlogContentType };
