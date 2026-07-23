import { prisma } from "@/lib/db";
import { checkHermesBridgeHealth } from "@/lib/agents/hermes-client";
import { getHermesUsageSummary } from "@/lib/hermes/hermes-usage";
import { getStockBlogSchedulerStatus } from "@/lib/stock-blog/stock-blog-scheduler";
import type {
  OperationsCostBreakdown,
  OperationsListItem,
  OperationsOverview,
  OperationsService,
} from "./operations-overview-types";
import { getKstDayWindow, getServiceOverallStatus } from "./operations-overview-rules";

const activeTaskStatuses = ["진행 중", "업무 중", "조사 중", "검토 중", "수정 중", "보고 중", "승인 대기", "결과 대기"];
const failedNaverStatuses = ["failed", "publish_blocked", "image_quality_failed", "image_upload_failed", "save_failed"];
const pendingNaverStatuses = ["queued", "claimed", "in_progress", "image_uploading", "draft_saving", "publishing"];

function decimalNumber(value: unknown) {
  if (value === null || value === undefined) return 0;
  const number = Number(typeof value === "object" && "toString" in value ? value.toString() : value);
  return Number.isFinite(number) ? number : 0;
}

function item(input: OperationsListItem): OperationsListItem {
  return input;
}

function sortNewest(items: OperationsListItem[]) {
  return items.sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
}

function service(input: OperationsService): OperationsService {
  return input;
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
    taskCostTotal,
    taskCostToday,
    departmentCostRows,
    employeeCostRows,
    pendingApprovalCost,
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
    prisma.task.aggregate({ _sum: { cost: true } }),
    prisma.task.aggregate({ where: { createdAt: { gte: start, lt: end } }, _sum: { cost: true } }),
    prisma.task.groupBy({ by: ["department"], _sum: { cost: true }, orderBy: { _sum: { cost: "desc" } } }),
    prisma.employee.findMany({
      where: { currentCost: { not: null } },
      orderBy: { currentCost: "desc" },
      select: { id: true, displayName: true, department: true, currentCost: true },
    }),
    prisma.approvalRequest.aggregate({ where: { status: "승인 대기" }, _sum: { estimatedCost: true } }),
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

  const departmentCosts: OperationsCostBreakdown[] = departmentCostRows
    .map((row) => ({ id: row.department, label: row.department, amount: decimalNumber(row._sum.cost), detail: "완료·진행 업무에 기록된 누적 비용" }))
    .filter((row) => row.amount > 0);
  const employeeCosts: OperationsCostBreakdown[] = employeeCostRows
    .map((row) => ({ id: row.id, label: row.displayName, amount: decimalNumber(row.currentCost), detail: `${row.department} · 현재 기록 비용` }))
    .filter((row) => row.amount > 0);
  const overallStatus = getServiceOverallStatus(developmentServices);
  const totalRecordedCost = decimalNumber(taskCostTotal._sum.cost);
  const todayRecordedCost = decimalNumber(taskCostToday._sum.cost);
  const plannedCost = decimalNumber(pendingApprovalCost._sum.estimatedCost);

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
      headline: `DB 기록 누적 비용은 $${totalRecordedCost.toFixed(2)}이며, 오늘 Hermes는 ${hermesUsage.used}/${hermesUsage.limit}회 사용했습니다.`,
      currency: "USD",
      metrics: [
        { label: "누적 기록 비용", value: `$${totalRecordedCost.toFixed(2)}`, note: "Task.cost 합계", tone: "info" },
        { label: "오늘 기록 비용", value: `$${todayRecordedCost.toFixed(2)}`, note: "오늘 생성 업무 기준", tone: "info" },
        { label: "승인 예정 비용", value: `$${plannedCost.toFixed(2)}`, note: "승인 대기 추정 비용", tone: plannedCost > 0 ? "warning" : "healthy" },
        { label: "Hermes 사용량", value: `${hermesUsage.used}/${hermesUsage.limit}`, note: `남음 ${hermesUsage.remaining}회`, tone: hermesUsage.remaining <= 4 ? "warning" : "healthy" },
      ],
      departmentCosts,
      employeeCosts,
      hermesUsed: hermesUsage.used,
      hermesLimit: hermesUsage.limit,
      note: "표시 금액은 BG Company DB의 Task.cost·Employee.currentCost 기록이며 실제 카드 또는 OpenAI 청구 금액과 다를 수 있습니다.",
    },
  };
}
