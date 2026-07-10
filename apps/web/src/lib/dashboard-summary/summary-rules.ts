import type { DashboardSummarySeverity } from "./summary-types";

type HermesUsageLike = { limit: number; used: number; remaining: number; blocked?: boolean };
type ContentPipelineLike = { title?: string | null; status?: string | null; currentStep?: string | null; runnerMode?: string | null };

const naverStatusLabels: Record<string, string> = {
  created: "임시저장 작업이 생성됐고 큐 진입을 기다립니다.",
  queued: "로컬 Naver Draft Agent가 가져갈 임시저장 작업이 대기 중입니다.",
  claimed: "로컬 에이전트가 작업을 가져갔습니다.",
  in_progress: "네이버 임시저장 작업이 진행 중입니다.",
  draft_saved: "네이버 블로그 임시저장이 완료됐습니다. 최종 발행은 사용자가 직접 확인합니다.",
  user_publish_required: "임시저장 후 사용자 발행 확인이 필요합니다.",
  completed: "게시 운영 작업이 완료됐습니다.",
  failed: "임시저장 작업이 실패했습니다. 로컬 에이전트 로그 확인이 필요합니다.",
  login_required: "네이버 로그인이 필요합니다.",
  captcha_required: "네이버 보안문자 확인이 필요합니다.",
  security_check_required: "네이버 보안 확인이 필요합니다.",
  cancelled: "임시저장 작업이 취소됐습니다.",
};

export function summarizeNaverDraftJobStatus(status?: string | null) {
  if (!status) return "네이버 임시저장 작업이 아직 없습니다.";
  return naverStatusLabels[status] ?? `네이버 임시저장 상태는 ${status}입니다.`;
}

export function summarizeHermesUsage(usage: HermesUsageLike) {
  if (usage.blocked || usage.remaining <= 0) return `오늘 Hermes 실행 한도 ${usage.limit}회 중 ${usage.used}회를 사용해 추가 실행이 차단됩니다.`;
  if (usage.remaining <= 4) return `오늘 Hermes ${usage.used}/${usage.limit}회를 사용했습니다. 4-Agent 파이프라인 기준 남은 실행 여유가 작습니다.`;
  return `오늘 Hermes ${usage.used}/${usage.limit}회를 사용했고 ${usage.remaining}회가 남아 있습니다.`;
}

export function summarizeContentPipelineStatus(pipeline?: ContentPipelineLike | null) {
  if (!pipeline) return "최근 콘텐츠 파이프라인이 없습니다. 다음 주식 브리핑을 생성할 수 있습니다.";
  const title = pipeline.title?.trim() || "최근 콘텐츠";
  const runner = pipeline.runnerMode ? ` · runner=${pipeline.runnerMode}` : "";
  if (pipeline.status === "approved") return `${title}은 승인 완료 상태입니다. 네이버 임시저장 또는 수동 발행 확인 단계입니다.${runner}`;
  if (pipeline.status === "failed") return `${title} 실행에 실패했습니다. 결과 로그와 Hermes Bridge 상태를 확인하세요.${runner}`;
  if (pipeline.status === "running") return `${title}이 실행 중입니다. 중복 실행하지 말고 완료 이벤트를 기다리세요.${runner}`;
  if (pipeline.status === "approval_requested") return `${title}은 Director 승인 대기 상태입니다.${runner}`;
  return `${title}의 현재 단계는 ${pipeline.currentStep || pipeline.status || "확인 필요"}입니다.${runner}`;
}

export function getNaverDraftSeverity(status?: string | null): DashboardSummarySeverity {
  if (!status) return "info";
  if (["failed", "captcha_required", "security_check_required", "login_required"].includes(status)) return "warning";
  if (["draft_saved", "completed"].includes(status)) return "good";
  return "info";
}

export function getHermesUsageSeverity(usage: HermesUsageLike): DashboardSummarySeverity {
  if (usage.blocked || usage.remaining <= 0) return "critical";
  if (usage.remaining <= 4) return "warning";
  return "good";
}
