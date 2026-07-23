import { prisma } from "@/lib/db";
import { listContentPipelines } from "@/lib/content-pipeline/content-pipeline-service";
import { getHermesUsageSummary } from "@/lib/hermes/hermes-usage";
import { listNaverDraftJobs } from "@/lib/naver-drafts/naver-draft-jobs";
import { getStockBlogScheduleItems } from "@/lib/stock-blog/stock-blog-workflow";
import { getStockBlogSchedulerStatus } from "@/lib/stock-blog/stock-blog-scheduler";
import {
  getHermesUsageSeverity,
  getNaverDraftSeverity,
  summarizeContentPipelineStatus,
  summarizeHermesUsage,
  summarizeNaverDraftJobStatus,
} from "./summary-rules";
import type { DashboardEmployeeActivity, DashboardSummary, DashboardSummaryCard, DashboardSummarySeverity } from "./summary-types";

const unfinishedTaskStatuses = ["진행 중", "업무 중", "조사 중", "검토 중", "수정 중", "보고 중", "오류", "오류 대응 중", "승인 대기", "결과 대기"];
const terminalNaverDraftStatuses = ["completed", "cancelled"];

function buildHeadline(input: { errorTasks: number; waitingApprovals: number; naverDraftPending: number; hermesRemaining: number }) {
  if (input.errorTasks > 0) return `오류 ${input.errorTasks}건을 먼저 확인해야 합니다.`;
  if (input.waitingApprovals > 0) return `승인 대기 ${input.waitingApprovals}건이 있습니다.`;
  if (input.naverDraftPending > 0) return `네이버 임시저장 작업 ${input.naverDraftPending}건이 대기 중입니다.`;
  if (input.hermesRemaining <= 4) return "Hermes 남은 실행 횟수가 낮습니다.";
  return "오늘 운영 상태는 안정적입니다.";
}

function getLatestNaverStatus(naverJobs: Awaited<ReturnType<typeof listNaverDraftJobs>>) {
  return naverJobs[0]?.status ?? null;
}

function activitySeverity(status: string): DashboardSummarySeverity {
  if (["failed", "오류", "오류 대응 중"].includes(status)) return "critical";
  if (["queued", "승인 대기", "결과 대기"].includes(status)) return "warning";
  if (["succeeded", "업무 완료", "완료"].includes(status)) return "good";
  return "info";
}

function activityStatusLabel(status: string) {
  const labels: Record<string, string> = {
    queued: "실행 대기",
    running: "실행 중",
    succeeded: "완료",
    failed: "실패",
    cancelled: "취소",
  };
  return labels[status] ?? status;
}

export async function buildDashboardSummary(): Promise<DashboardSummary> {
  const [activeTasks, activeTaskRows, waitingApprovals, errorTasks, recentAgentRuns, contentPipelines, naverJobs, hermesUsage, stockBlogScheduler] = await Promise.all([
    prisma.task.count({ where: { status: { in: unfinishedTaskStatuses } } }),
    prisma.task.findMany({
      where: { status: { in: unfinishedTaskStatuses } },
      orderBy: { updatedAt: "desc" },
      take: 8,
      select: {
        id: true,
        title: true,
        status: true,
        progress: true,
        currentStep: true,
        recentOutput: true,
        updatedAt: true,
        assignedEmployee: { select: { id: true, displayName: true, role: true } },
      },
    }),
    prisma.approvalRequest.count({ where: { status: "승인 대기" } }),
    prisma.task.count({ where: { OR: [{ status: "오류" }, { error: { not: null } }] } }),
    prisma.agentRun.findMany({
      orderBy: { createdAt: "desc" },
      take: 8,
      select: {
        id: true,
        employeeId: true,
        status: true,
        mode: true,
        createdAt: true,
        startedAt: true,
        completedAt: true,
        resultSummary: true,
        errorMessage: true,
        employee: { select: { displayName: true, role: true } },
        task: { select: { title: true } },
      },
    }),
    listContentPipelines(),
    listNaverDraftJobs(),
    getHermesUsageSummary({ recentLimit: 6 }),
    getStockBlogSchedulerStatus(),
  ]);

  const latestPipeline = contentPipelines[0] ?? null;
  const latestNaverStatus = getLatestNaverStatus(naverJobs);
  const naverDraftPending = naverJobs.filter((job) => !terminalNaverDraftStatuses.includes(job.status)).length;
  const cards: DashboardSummaryCard[] = [
    {
      id: "content-pipeline",
      title: "콘텐츠 파이프라인",
      value: latestPipeline ? latestPipeline.status : "대기",
      description: summarizeContentPipelineStatus(latestPipeline),
      severity: latestPipeline?.status === "rejected" ? "warning" : latestPipeline?.status === "approved" ? "good" : "info",
      actionLabel: "콘텐츠 확인",
    },
    {
      id: "naver-draft",
      title: "네이버 임시저장",
      value: naverDraftPending > 0 ? `${naverDraftPending}건` : "없음",
      description: summarizeNaverDraftJobStatus(latestNaverStatus),
      severity: getNaverDraftSeverity(latestNaverStatus),
      actionLabel: "게시 준비 확인",
    },
    {
      id: "hermes-usage",
      title: "Hermes 사용량",
      value: `${hermesUsage.used}/${hermesUsage.limit}`,
      description: summarizeHermesUsage(hermesUsage),
      severity: getHermesUsageSeverity(hermesUsage),
      actionLabel: "실행 한도 확인",
    },
    {
      id: "approvals",
      title: "승인함",
      value: `${waitingApprovals}건`,
      description: waitingApprovals > 0 ? "Director 승인 후 네이버 임시저장 큐로 이어질 수 있습니다." : "현재 승인 대기 항목은 없습니다.",
      severity: waitingApprovals > 0 ? "warning" : "good",
      actionLabel: "승인함 보기",
    },
    {
      id: "stock-blog-scheduler",
      title: "주식 블로그 스케줄러",
      value: stockBlogScheduler.enabled ? "ON" : "OFF",
      description: stockBlogScheduler.publishCircuitBreaker.active
        ? "첫 자동 발행이 실패해 자동 발행이 일시 중지되었습니다."
        : stockBlogScheduler.nextRun
        ? `다음 자동 실행: ${stockBlogScheduler.nextRun.label} · ${stockBlogScheduler.nextRun.scheduledTimeKst} · ${stockBlogScheduler.runnerMode}`
        : "등록된 다음 자동 실행이 없습니다.",
      severity: stockBlogScheduler.publishCircuitBreaker.active ? "warning" : stockBlogScheduler.enabled ? "good" : "info",
      actionLabel: "스케줄 확인",
    },
  ];

  const headline = buildHeadline({ errorTasks, waitingApprovals, naverDraftPending, hermesRemaining: hermesUsage.remaining });
  const agentRunSummary = recentAgentRuns.length > 0
    ? `최근 AgentRun은 ${recentAgentRuns[0].employee.displayName} / ${activityStatusLabel(recentAgentRuns[0].status)} 상태입니다.`
    : "최근 AgentRun 기록은 아직 없습니다.";
  const activeWork: DashboardEmployeeActivity[] = activeTaskRows.map((task) => ({
    id: `task-${task.id}`,
    employeeId: task.assignedEmployee?.id ?? null,
    employeeName: task.assignedEmployee?.displayName ?? "담당 미지정",
    employeeRole: task.assignedEmployee?.role ?? null,
    taskTitle: task.title,
    status: task.status,
    statusLabel: task.status,
    severity: activitySeverity(task.status),
    detail: task.currentStep?.trim() || task.recentOutput?.trim() || `진행률 ${task.progress}%`,
    source: "Task",
    mode: null,
    occurredAt: task.updatedAt.toISOString(),
  }));
  const recentAgentActivity: DashboardEmployeeActivity[] = recentAgentRuns.map((run) => ({
    id: `agent-run-${run.id}`,
    employeeId: run.employeeId,
    employeeName: run.employee.displayName,
    employeeRole: run.employee.role,
    taskTitle: run.task?.title ?? `${run.mode} 실행`,
    status: run.status,
    statusLabel: activityStatusLabel(run.status),
    severity: activitySeverity(run.status),
    detail: run.errorMessage?.trim() || run.resultSummary?.trim() || `${activityStatusLabel(run.status)} 상태로 기록됐습니다.`,
    source: "AgentRun",
    mode: run.mode,
    occurredAt: (run.completedAt ?? run.startedAt ?? run.createdAt).toISOString(),
  }));

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    headline,
    briefing: `${summarizeContentPipelineStatus(latestPipeline)} ${summarizeHermesUsage(hermesUsage)} ${agentRunSummary}`,
    cards,
    activeWork,
    recentAgentActivity,
    nextActions: [
      waitingApprovals > 0 ? "승인함에서 Director 승인 대기 항목을 먼저 처리하세요." : "승인함은 안정적입니다.",
      naverDraftPending > 0 ? "로컬 Naver Draft Agent 상태와 네이버 로그인 상태를 확인하세요." : "새 주식 브리핑을 생성할 수 있습니다.",
      hermesUsage.remaining < 4 ? "오늘 Hermes 실제 실행은 신중하게 진행하세요." : "Hermes 4-Agent 실행 여유가 있습니다.",
      stockBlogScheduler.publishCircuitBreaker.active
        ? "첫 자동 발행 실패 원인을 해결하고 circuit breaker를 수동 점검하세요. 자동 재시도는 하지 않습니다."
        : stockBlogScheduler.enabled
          ? "주식 블로그 스케줄러가 켜져 있습니다. Local Naver Draft Agent 실행 상태를 유지하세요."
          : "자동 생성은 아직 꺼져 있습니다. 운영 준비 후 STOCK_BLOG_SCHEDULER_ENABLED=true로 전환하세요.",
    ],
    metrics: {
      activeTasks,
      waitingApprovals,
      errorTasks,
      naverDraftPending,
      hermesUsed: hermesUsage.used,
      hermesLimit: hermesUsage.limit,
      hermesRemaining: hermesUsage.remaining,
    },
    stockBlogSchedule: getStockBlogScheduleItems(),
    stockBlogScheduler,
  };
}
