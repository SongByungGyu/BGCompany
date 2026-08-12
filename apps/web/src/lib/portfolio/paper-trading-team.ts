import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { createEvent } from "@/lib/repositories/events";
import {
  buildPaperTradingTeamReviewDrafts,
  type PaperTradingTeamRole,
} from "./paper-trading-team-analysis";

const PAPER_TEAM = [
  {
    employeeId: "stock-monitor",
    displayName: "서준",
    initial: "서",
    role: "수석 트레이더",
    teamRole: "LEAD_ANALYST" as PaperTradingTeamRole,
    responsibility: "분기 모멘텀 계획·후보 신호·시장 상태 분석",
    seat: "stock-seat-01",
    taskId: "task-paper-lead-analysis",
    taskTitle: "모의투자 전략·신호 분석",
    displayOrder: 1,
  },
  {
    employeeId: "risk-trader",
    displayName: "민서",
    initial: "민",
    role: "리스크 트레이더",
    teamRole: "RISK_MANAGER" as PaperTradingTeamRole,
    responsibility: "현금·노출·보유 한도·위험 이벤트 독립 심사",
    seat: "stock-seat-02",
    taskId: "task-paper-risk-analysis",
    taskTitle: "모의계좌 위험·노출 심사",
    displayOrder: 2,
  },
  {
    employeeId: "execution-trader",
    displayName: "태오",
    initial: "태",
    role: "체결·성과 트레이더",
    teamRole: "EXECUTION_REVIEWER" as PaperTradingTeamRole,
    responsibility: "가상 주문·체결·슬리피지·성과 감사",
    seat: "stock-seat-03",
    taskId: "task-paper-execution-analysis",
    taskTitle: "가상 체결·성과 감사",
    displayOrder: 3,
  },
] as const;

function dateOnly(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`잘못된 시장 날짜입니다: ${value}`);
  return new Date(`${value}T00:00:00.000Z`);
}

function numeric(value: { toString(): string } | number | null | undefined) {
  const parsed = Number(value?.toString() ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function jsonRecord(value: Prisma.JsonValue | null | undefined) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, Prisma.JsonValue>
    : {};
}

async function createEventOnce(input: Parameters<typeof createEvent>[0]) {
  if (!input.id) return createEvent(input);
  const existing = await prisma.eventLog.findUnique({ where: { id: input.id }, select: { id: true } });
  return existing ? null : createEvent(input);
}

export async function ensurePaperTradingTeam(accountId: string) {
  await prisma.$transaction(async (tx) => {
    for (const member of PAPER_TEAM) {
      await tx.employee.upsert({
        where: { id: member.employeeId },
        create: {
          id: member.employeeId,
          displayName: member.displayName,
          initial: member.initial,
          department: "주식팀",
          role: member.role,
          status: "대기 중",
          currentTaskId: member.taskId,
          currentLocation: member.seat,
          model: "Rules Engine",
        },
        update: {
          displayName: member.displayName,
          initial: member.initial,
          department: "주식팀",
          role: member.role,
          model: "Rules Engine",
        },
      });
      await tx.task.upsert({
        where: { id: member.taskId },
        create: {
          id: member.taskId,
          title: member.taskTitle,
          description: member.responsibility,
          department: "주식팀",
          assignedEmployeeId: member.employeeId,
          status: "대기",
          progress: 0,
          model: "Rules Engine",
          currentStep: "다음 미국 시장일 데이터 대기",
          nextAction: "07:20 KST 모의투자 실행 후 독립 분석",
        },
        update: {
          title: member.taskTitle,
          description: member.responsibility,
          department: "주식팀",
          assignedEmployeeId: member.employeeId,
          model: "Rules Engine",
          nextAction: "07:20 KST 모의투자 실행 후 독립 분석",
        },
      });
      await tx.paperTradingTeamMember.upsert({
        where: { accountId_employeeId: { accountId, employeeId: member.employeeId } },
        create: {
          accountId,
          employeeId: member.employeeId,
          role: member.teamRole,
          responsibility: member.responsibility,
          status: "ACTIVE",
          canAnalyze: true,
          canApproveVirtualOrder: false,
          canSubmitBrokerOrder: false,
          displayOrder: member.displayOrder,
        },
        update: {
          role: member.teamRole,
          responsibility: member.responsibility,
          status: "ACTIVE",
          canAnalyze: true,
          canApproveVirtualOrder: false,
          canSubmitBrokerOrder: false,
          displayOrder: member.displayOrder,
        },
      });
    }
  });
}

export async function refreshPaperTradingTeamReviews(accountId: string, marketDate: string) {
  await ensurePaperTradingTeam(accountId);
  const day = dateOnly(marketDate);
  const nextDay = new Date(day);
  nextDay.setUTCDate(nextDay.getUTCDate() + 1);
  const account = await prisma.paperTradingAccount.findUnique({ where: { id: accountId } });
  if (!account) throw new Error("모의계좌를 찾을 수 없습니다.");
  const [members, signals, orders, fills, positions, snapshot, riskEvents, existingReviews] = await Promise.all([
    prisma.paperTradingTeamMember.findMany({ where: { accountId, status: "ACTIVE" }, orderBy: { displayOrder: "asc" } }),
    prisma.paperTradingSignal.findMany({ where: { accountId, processedAt: { gte: day, lt: nextDay } } }),
    prisma.paperTradingOrder.findMany({ where: { accountId, marketDate: day } }),
    prisma.paperTradingFill.findMany({ where: { accountId, order: { marketDate: day } } }),
    prisma.paperTradingPosition.findMany({ where: { accountId, status: "OPEN" } }),
    prisma.paperTradingSnapshot.findUnique({ where: { accountId_marketDate: { accountId, marketDate: day } } }),
    prisma.paperTradingRiskEvent.findMany({ where: { accountId, createdAt: { gte: day, lt: nextDay } } }),
    prisma.paperTradingTeamReview.findMany({ where: { accountId, marketDate: day } }),
  ]);
  const memberByRole = new Map(members.map((member) => [member.role as PaperTradingTeamRole, member]));
  const existingKeys = new Set(existingReviews.map((review) => `${review.teamMemberId}:${review.reviewType}`));
  const marketValueKrw = numeric(snapshot?.marketValueKrw) || Math.max(0, numeric(account.equityKrw) - numeric(account.cashKrw));
  const accountRules = jsonRecord(account.rules);
  const drafts = buildPaperTradingTeamReviewDrafts({
    marketDate,
    initialCapitalKrw: numeric(account.initialCapitalKrw),
    cashKrw: numeric(snapshot?.cashKrw ?? account.cashKrw),
    equityKrw: numeric(snapshot?.equityKrw ?? account.equityKrw),
    marketValueKrw,
    openPositions: positions.length,
    acceptedSignals: signals.filter((signal) => signal.status === "ACCEPTED").length,
    rejectedSignals: signals.filter((signal) => signal.status === "REJECTED").length,
    filledOrders: orders.filter((order) => order.status === "FILLED").length,
    rejectedOrders: orders.filter((order) => order.status === "REJECTED").length,
    fills: fills.length,
    riskEventCount: riskEvents.length,
    highRiskEventCount: riskEvents.filter((event) => event.severity === "high" || event.severity === "critical").length,
    configuredSlippageBps: numeric(typeof accountRules.slippageBps === "number" ? accountRules.slippageBps : 0),
    averageSlippageBps: fills.length ? fills.reduce((sum, fill) => sum + numeric(fill.slippageBps), 0) / fills.length : 0,
  });

  for (const draft of drafts) {
    const teamMember = memberByRole.get(draft.role);
    const definition = PAPER_TEAM.find((item) => item.teamRole === draft.role);
    if (!teamMember || !definition) continue;
    const isNew = !existingKeys.has(`${teamMember.id}:${draft.reviewType}`);
    if (isNew) {
      await createEventOnce({
        id: `event-paper-team-start:${accountId}:${marketDate}:${draft.role}`,
        type: "TaskStarted",
        employeeId: definition.employeeId,
        taskId: definition.taskId,
        payload: { marketDate, reviewType: draft.reviewType, title: definition.taskTitle },
        summary: `${definition.displayName} ${marketDate} 모의투자 분석 시작`,
      });
    }
    await prisma.paperTradingTeamReview.upsert({
      where: {
        accountId_teamMemberId_marketDate_reviewType: {
          accountId,
          teamMemberId: teamMember.id,
          marketDate: day,
          reviewType: draft.reviewType,
        },
      },
      create: {
        accountId,
        teamMemberId: teamMember.id,
        marketDate: day,
        reviewType: draft.reviewType,
        recommendation: draft.recommendation,
        confidence: draft.confidence,
        summary: draft.summary,
        details: draft.details as Prisma.InputJsonValue,
        status: "COMPLETED",
      },
      update: {
        recommendation: draft.recommendation,
        confidence: draft.confidence,
        summary: draft.summary,
        details: draft.details as Prisma.InputJsonValue,
        status: "COMPLETED",
      },
    });
    if (isNew) {
      await createEventOnce({
        id: `event-paper-team-output:${accountId}:${marketDate}:${draft.role}`,
        type: "OutputGenerated",
        employeeId: definition.employeeId,
        taskId: definition.taskId,
        payload: { marketDate, reviewType: draft.reviewType, recommendation: draft.recommendation, output: draft.summary, status: "결과 대기" },
        summary: draft.summary,
      });
    }
    await prisma.$transaction([
      prisma.task.update({
        where: { id: definition.taskId },
        data: {
          status: "진행 중",
          progress: 100,
          currentStep: `${marketDate} 독립 분석 완료`,
          recentOutput: draft.summary,
          nextAction: "다음 시장일 분석 대기",
          error: null,
        },
      }),
      prisma.employee.update({
        where: { id: definition.employeeId },
        data: {
          status: "결과 대기",
          currentTaskId: definition.taskId,
          currentLocation: definition.seat,
        },
      }),
    ]);
  }
}

export async function getPaperTradingTeamView(accountId: string) {
  const members = await prisma.paperTradingTeamMember.findMany({
    where: { accountId, status: "ACTIVE" },
    include: { employee: true, reviews: { orderBy: [{ marketDate: "desc" }, { createdAt: "desc" }], take: 5 } },
    orderBy: { displayOrder: "asc" },
  });
  const latestMarketDate = members.flatMap((member) => member.reviews).map((review) => review.marketDate.toISOString().slice(0, 10)).sort().at(-1) ?? null;
  const latestReviews = members.flatMap((member) => member.reviews
    .filter((review) => review.marketDate.toISOString().slice(0, 10) === latestMarketDate)
    .map((review) => ({
      id: review.id,
      employeeId: member.employeeId,
      displayName: member.employee.displayName,
      role: member.role,
      marketDate: review.marketDate.toISOString().slice(0, 10),
      reviewType: review.reviewType,
      recommendation: review.recommendation,
      confidence: review.confidence,
      summary: review.summary,
      status: review.status,
      updatedAt: review.updatedAt.toISOString(),
    })));
  const requiresReview = latestReviews.some((review) => review.recommendation.endsWith("REQUIRED"));
  return {
    operatingMode: "OBSERVE_ONLY" as const,
    canSubmitBrokerOrder: false as const,
    members: members.map((member) => ({
      employeeId: member.employeeId,
      displayName: member.employee.displayName,
      role: member.role,
      responsibility: member.responsibility,
      status: member.status,
      canAnalyze: member.canAnalyze,
      canApproveVirtualOrder: member.canApproveVirtualOrder,
      canSubmitBrokerOrder: member.canSubmitBrokerOrder,
      displayOrder: member.displayOrder,
    })),
    latestMarketDate,
    latestReviews,
    consensus: latestReviews.length === 3
      ? {
        status: requiresReview ? "REVIEW_REQUIRED" as const : "TEAM_REVIEW_COMPLETE" as const,
        summary: requiresReview ? "3인 분석 중 재검토 필요 항목이 있습니다." : "전략·위험·체결 3개 독립 검토가 완료됐습니다.",
      }
      : null,
  };
}
