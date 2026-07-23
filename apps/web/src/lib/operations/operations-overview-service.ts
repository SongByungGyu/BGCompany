import { prisma } from "@/lib/db";
import { checkHermesBridgeHealth } from "@/lib/agents/hermes-client";
import { getOpenAIFinanceSummary } from "@/lib/finance/openai-finance-client";
import { getHermesUsageSummary } from "@/lib/hermes/hermes-usage";
import { getStockBlogSchedulerStatus } from "@/lib/stock-blog/stock-blog-scheduler";
import type {
  OperationsCostBreakdown,
  OperationsHealth,
  OperationsListItem,
  OperationsOverview,
  OperationsService,
} from "./operations-overview-types";
import { getKstDayWindow, getServiceOverallStatus } from "./operations-overview-rules";

const activeTaskStatuses = ["진행 중", "업무 중", "조사 중", "검토 중", "수정 중", "보고 중", "승인 대기", "결과 대기"];
const failedNaverStatuses = ["failed", "publish_blocked", "image_quality_failed", "image_upload_failed", "save_failed"];
const pendingNaverStatuses = ["queued", "claimed", "in_progress", "image_uploading", "draft_saving", "publishing"];

function item(input: OperationsListItem): OperationsListItem {
  return input;
}

function sortNewest(items: OperationsListItem[]) {
  return items.sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
}

function service(input: OperationsService): OperationsService {
  return input;
}

function formatUsd(value: number | null) {
  if (value === null) return "—";
  const digits = value > 0 && value < 0.01 ? 4 : 2;
  return `$${value.toFixed(digits)}`;
}

function formatCompactNumber(value: number | null) {
  if (value === null) return "—";
  return new Intl.NumberFormat("ko-KR", { notation: value >= 10_000 ? "compact" : "standard", maximumFractionDigits: 1 }).format(value);
}

function financeTone(status: OperationsOverview["finance"]["providerStatus"]): OperationsHealth {
  if (status === "connected") return "healthy";
  if (status === "forbidden") return "critical";
  return "warning";
}

function projectLabel(projectId: string) {
  if (projectId === "organization") return "조직 공통";
  if (projectId.length <= 16) return projectId;
  return `${projectId.slice(0, 9)}…${projectId.slice(-4)}`;
}

export async function buildOperationsOverview(now = new Date()): Promise<OperationsOverview> {
  const { start, end, date } = getKstDayWindow(now);
  let databaseHealthy = true;
  let databaseMessage = "DB 조회가 정상입니다.";

  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch (error) {
    databaseHealthy = false;
    databaseMessage = error instanceof Error ? error.message : "DB 상태를 확인하지 못했습니다.";
  }

  const [
    completedTasks,
    activeTaskCount,
    errorTasks,
    waitingApprovals,
    decidedApprovalCount,
    todayAgentRuns,
    recentAgentRuns,
    publishedJobs,
    recentNaverJobs,
    openaiFinance,
    hermesUsage,
    hermesHealth,
    scheduler,
  ] = await Promise.all([
    prisma.task.findMany({
      where: { completedAt: { gte: start, lt: end } },
      orderBy: { completedAt: "desc" },
      take: 8,
      select: { id: true, title: true, department: true, completedAt: true },
    }),
    prisma.task.count({ where: { status: { in: activeTaskStatuses } } }),
    prisma.task.findMany({
      where: { OR: [{ status: "오류" }, { error: { not: null } }] },
      orderBy: { updatedAt: "desc" },
      take: 6,
      select: { id: true, title: true, error: true, updatedAt: true },
    }),
    prisma.approvalRequest.findMany({
      where: { status: "승인 대기" },
      orderBy: { createdAt: "asc" },
      take: 6,
      select: { id: true, title: true, riskLevel: true, createdAt: true },
    }),
    prisma.approvalRequest.count({ where: { decidedAt: { gte: start, lt: end } } }),
    prisma.agentRun.findMany({
      where: { createdAt: { gte: start, lt: end } },
      orderBy: { createdAt: "desc" },
      select: { id: true, employeeId: true, status: true, resultSummary: true, errorMessage: true, createdAt: true, completedAt: true },
    }),
    prisma.agentRun.findMany({
      orderBy: { createdAt: "desc" },
      take: 8,
      select: { id: true, employeeId: true, status: true, resultSummary: true, errorMessage: true, createdAt: true, completedAt: true },
    }),
    prisma.naverDraftJob.findMany({
      where: { status: "published", publishedAt: { gte: start, lt: end } },
      orderBy: { publishedAt: "desc" },
      take: 6,
      select: { id: true, title: true, publishedAt: true, publishedUrl: true },
    }),
    prisma.naverDraftJob.findMany({
      orderBy: { updatedAt: "desc" },
      take: 10,
      select: { id: true, title: true, status: true, errorCode: true, errorMessage: true, updatedAt: true, publishedAt: true },
    }),
    getOpenAIFinanceSummary({ now }),
    getHermesUsageSummary({ recentLimit: 6, now }),
    checkHermesBridgeHealth(),
    getStockBlogSchedulerStatus(now),
  ]);

  const succeededRuns = todayAgentRuns.filter((run) => run.status === "succeeded");
  const failedRuns = todayAgentRuns.filter((run) => run.status === "failed");
  const reportHighlights = sortNewest([
    ...publishedJobs.map((job) => item({
      id: `published-${job.id}`,
      title: job.title,
      detail: "네이버 자동발행 완료",
      timestamp: (job.publishedAt ?? now).toISOString(),
      tone: "healthy",
      href: job.publishedUrl,
    })),
    ...completedTasks.map((task) => item({
      id: `task-${task.id}`,
      title: task.title,
      detail: `${task.department} · 업무 완료`,
      timestamp: (task.completedAt ?? now).toISOString(),
      tone: "healthy",
    })),
    ...succeededRuns.slice(0, 6).map((run) => item({
      id: `run-${run.id}`,
      title: run.resultSummary || `${run.employeeId} 작업 완료`,
      detail: `${run.employeeId} · AgentRun 성공`,
      timestamp: (run.completedAt ?? run.createdAt).toISOString(),
      tone: "healthy",
    })),
  ]).slice(0, 10);

  const latestPendingJob = recentNaverJobs.find((job) => pendingNaverStatuses.includes(job.status));
  const reportOpenItems = sortNewest([
    ...errorTasks.map((task) => item({
      id: `task-error-${task.id}`,
      title: task.title,
      detail: task.error || "업무 오류를 확인해야 합니다.",
      timestamp: task.updatedAt.toISOString(),
      tone: "critical",
    })),
    ...waitingApprovals.map((approval) => item({
      id: `approval-${approval.id}`,
      title: approval.title,
      detail: `${approval.riskLevel} 위험도 · 승인 대기`,
      timestamp: approval.createdAt.toISOString(),
      tone: "warning",
    })),
    ...(latestPendingJob ? [item({
      id: `naver-pending-${latestPendingJob.id}`,
      title: latestPendingJob.title,
      detail: `네이버 작업 ${latestPendingJob.status}`,
      timestamp: latestPendingJob.updatedAt.toISOString(),
      tone: "warning",
    })] : []),
  ]).slice(0, 8);

  const latestNaverJob = recentNaverJobs[0] ?? null;
  const latestNaverFailed = latestNaverJob && failedNaverStatuses.includes(latestNaverJob.status);
  const latestNaverPendingTooLong = latestNaverJob
    && pendingNaverStatuses.includes(latestNaverJob.status)
    && now.getTime() - latestNaverJob.updatedAt.getTime() > 20 * 60 * 1000;

  const developmentServices: OperationsService[] = [
    service({ id: "web", name: "BG Company Web", status: "healthy", label: "정상", detail: "운영 API가 응답하고 있습니다.", checkedAt: now.toISOString() }),
    service({ id: "database", name: "PostgreSQL", status: databaseHealthy ? "healthy" : "critical", label: databaseHealthy ? "정상" : "오류", detail: databaseMessage, checkedAt: now.toISOString() }),
    service({ id: "hermes", name: "Hermes Bridge", status: hermesHealth.ok ? "healthy" : "critical", label: hermesHealth.ok ? "정상" : "오류", detail: hermesHealth.message || "Hermes 상태 메시지가 없습니다.", checkedAt: now.toISOString() }),
    service({
      id: "scheduler",
      name: "주식 블로그 스케줄러",
      status: !scheduler.enabled || scheduler.publishCircuitBreaker.active ? "critical" : "healthy",
      label: !scheduler.enabled ? "꺼짐" : scheduler.publishCircuitBreaker.active ? "차단" : "정상",
      detail: scheduler.publishCircuitBreaker.active
        ? scheduler.publishCircuitBreaker.message || "자동발행 차단기가 활성화됐습니다."
        : scheduler.nextRun ? `다음 실행 ${scheduler.nextRun.label} · ${scheduler.nextRun.scheduledTimeKst}` : "다음 실행을 계산 중입니다.",
      checkedAt: now.toISOString(),
    }),
    service({
      id: "naver-agent",
      name: "Naver Draft Agent",
      status: latestNaverFailed || latestNaverPendingTooLong ? "warning" : latestNaverJob ? "healthy" : "idle",
      label: latestNaverFailed ? "실패 기록" : latestNaverPendingTooLong ? "지연" : latestNaverJob ? "정상" : "대기",
      detail: latestNaverJob
        ? `최근 작업 ${latestNaverJob.status} · ${latestNaverJob.title}`
        : "아직 네이버 작업 기록이 없습니다.",
      checkedAt: now.toISOString(),
    }),
  ];

  const incidents = sortNewest([
    ...recentAgentRuns.filter((run) => run.status === "failed").map((run) => item({
      id: `agent-failure-${run.id}`,
      title: `${run.employeeId} AgentRun 실패`,
      detail: run.errorMessage || run.resultSummary || "실패 원인을 확인해야 합니다.",
      timestamp: run.createdAt.toISOString(),
      tone: "critical",
    })),
    ...recentNaverJobs.filter((job) => failedNaverStatuses.includes(job.status)).slice(0, 4).map((job) => item({
      id: `naver-failure-${job.id}`,
      title: job.title,
      detail: `${job.errorCode || job.status} · ${job.errorMessage || "네이버 작업 실패 기록"}`,
      timestamp: job.updatedAt.toISOString(),
      tone: "warning",
    })),
    ...errorTasks.map((task) => item({
      id: `development-task-${task.id}`,
      title: task.title,
      detail: task.error || "개발 업무 오류",
      timestamp: task.updatedAt.toISOString(),
      tone: "critical",
    })),
  ]).slice(0, 8);

  const recentRunItems = recentAgentRuns.map((run) => item({
    id: `recent-run-${run.id}`,
    title: run.resultSummary || `${run.employeeId} 실행`,
    detail: `${run.employeeId} · ${run.status}`,
    timestamp: (run.completedAt ?? run.createdAt).toISOString(),
    tone: run.status === "succeeded" ? "healthy" : run.status === "failed" ? "critical" : "warning",
  }));

  const lineItemCosts: OperationsCostBreakdown[] = openaiFinance.lineItems.map((row) => ({
    id: row.id,
    label: row.label,
    amount: row.amountUsd,
    detail: "OpenAI 청구 항목 · 이번 달 실비",
  }));
  const projectCosts: OperationsCostBreakdown[] = openaiFinance.projects.map((row) => ({
    id: row.id,
    label: projectLabel(row.label),
    amount: row.amountUsd,
    detail: "OpenAI 프로젝트 · 이번 달 실비",
  }));
  const overallStatus = getServiceOverallStatus(developmentServices);
  const providerTone = financeTone(openaiFinance.status);

  return {
    ok: true,
    generatedAt: now.toISOString(),
    report: {
      date,
      headline: reportOpenItems.some((entry) => entry.tone === "critical")
        ? `오늘 완료 ${reportHighlights.length}건, 우선 확인할 오류가 있습니다.`
        : `오늘 완료 ${reportHighlights.length}건, 운영 흐름은 안정적입니다.`,
      summary: `업무 완료 ${completedTasks.length}건, AgentRun 성공 ${succeededRuns.length}건, 네이버 발행 ${publishedJobs.length}건입니다. 승인 대기 ${waitingApprovals.length}건과 실행 중 업무 ${activeTaskCount}건을 이어서 확인합니다.`,
      metrics: [
        { label: "완료 업무", value: `${completedTasks.length}건`, note: "오늘 완료 시각 기준", tone: "healthy" },
        { label: "AgentRun", value: `${succeededRuns.length}/${todayAgentRuns.length}`, note: failedRuns.length > 0 ? `실패 ${failedRuns.length}건 포함` : "오늘 성공/전체", tone: failedRuns.length > 0 ? "warning" : "healthy" },
        { label: "네이버 발행", value: `${publishedJobs.length}건`, note: "오늘 실제 발행", tone: publishedJobs.length > 0 ? "healthy" : "idle" },
        { label: "승인 처리", value: `${decidedApprovalCount}건`, note: `현재 대기 ${waitingApprovals.length}건`, tone: waitingApprovals.length > 0 ? "warning" : "healthy" },
      ],
      highlights: reportHighlights,
      openItems: reportOpenItems,
    },
    development: {
      overallStatus,
      headline: overallStatus === "healthy" ? "핵심 서비스가 정상 응답 중입니다." : "확인이 필요한 서비스 또는 오류 기록이 있습니다.",
      services: developmentServices,
      incidents,
      recentRuns: recentRunItems,
    },
    finance: {
      headline: openaiFinance.status === "connected"
        ? `OpenAI 공식 비용 기준 이달 ${formatUsd(openaiFinance.costs.monthUsd)}, API 요청 ${formatCompactNumber(openaiFinance.usage.requests)}회입니다.`
        : openaiFinance.message,
      currency: "USD",
      providerStatus: openaiFinance.status,
      source: openaiFinance.source,
      message: openaiFinance.message,
      collectedAt: openaiFinance.collectedAt,
      costs: openaiFinance.costs,
      usage: {
        requests: openaiFinance.usage.requests,
        inputTokens: openaiFinance.usage.inputTokens,
        outputTokens: openaiFinance.usage.outputTokens,
      },
      metrics: [
        { label: "이번 달 실비", value: formatUsd(openaiFinance.costs.monthUsd), note: openaiFinance.status === "connected" ? "OpenAI Costs API" : "Admin Key 연결 필요", tone: providerTone },
        { label: "최근 7일", value: formatUsd(openaiFinance.costs.last7DaysUsd), note: "KST 기준 실제 비용", tone: providerTone },
        { label: "오늘 비용", value: formatUsd(openaiFinance.costs.todayUsd), note: "공식 집계는 지연될 수 있음", tone: providerTone },
        { label: "API 요청", value: formatCompactNumber(openaiFinance.usage.requests), note: "이번 달 모델 요청", tone: openaiFinance.usage.available ? "info" : "idle" },
        { label: "입·출력 토큰", value: openaiFinance.usage.available ? formatCompactNumber((openaiFinance.usage.inputTokens ?? 0) + (openaiFinance.usage.outputTokens ?? 0)) : "—", note: openaiFinance.usage.available ? `입력 ${formatCompactNumber(openaiFinance.usage.inputTokens)} · 출력 ${formatCompactNumber(openaiFinance.usage.outputTokens)}` : "Usage API 연결 필요", tone: openaiFinance.usage.available ? "info" : "idle" },
        { label: "오늘 Hermes", value: `${hermesUsage.used}/${hermesUsage.limit}`, note: `내부 실행 한도 · 남음 ${hermesUsage.remaining}회`, tone: hermesUsage.remaining <= 4 ? "warning" : "healthy" },
      ],
      lineItemCosts,
      projectCosts,
      hermesUsed: hermesUsage.used,
      hermesLimit: hermesUsage.limit,
      note: "금액은 OpenAI 조직 Costs API의 청구 집계만 사용합니다. Task.cost·Employee.currentCost Seed 값은 재정 화면에서 제외하며, 공식 집계는 사용 직후 다소 지연될 수 있습니다.",
    },
  };
}
