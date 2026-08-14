import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../db.ts";
import {
  classifyOperationalFailure,
  isOperationalFailureEvent,
  operationalLessonVerificationErrors,
  selectApplicableLessonInstructions,
  shouldCreateImprovementProposal,
  type OperationalFailureInput,
  type OperationalLessonInstruction,
} from "./operational-learning-policy.ts";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function shortString(value: unknown, limit = 500) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, limit) : undefined;
}

function safeFailureMetadata(payload: Record<string, unknown>): Prisma.InputJsonObject {
  const qualityGate = asRecord(payload.qualityGate);
  const reasons = Array.isArray(qualityGate.reasons)
    ? qualityGate.reasons.filter((item): item is string => typeof item === "string").slice(0, 5).map((item) => item.slice(0, 300))
    : [];
  return {
    ...(shortString(payload.runId, 160) ? { runId: shortString(payload.runId, 160)! } : {}),
    ...(shortString(payload.contentPipelineId, 160) ? { contentPipelineId: shortString(payload.contentPipelineId, 160)! } : {}),
    ...(shortString(payload.scheduleKey, 200) ? { scheduleKey: shortString(payload.scheduleKey, 200)! } : {}),
    ...(shortString(payload.contentType, 100) ? { contentType: shortString(payload.contentType, 100)! } : {}),
    ...(shortString(payload.failurePhase, 100) ? { failurePhase: shortString(payload.failurePhase, 100)! } : {}),
    ...(shortString(payload.status, 100) ? { status: shortString(payload.status, 100)! } : {}),
    ...(typeof payload.attempt === "number" ? { attempt: payload.attempt } : {}),
    ...(typeof payload.retryable === "boolean" ? { retryable: payload.retryable } : {}),
    ...(shortString(qualityGate.status, 100) || reasons.length > 0
      ? { qualityGate: { ...(shortString(qualityGate.status, 100) ? { status: shortString(qualityGate.status, 100)! } : {}), reasons } }
      : {}),
  };
}

function initialLessonStatus(stage: string) {
  return stage === "reference-preflight" || stage === "quality-gate" ? "contained" : "observed";
}

async function createImprovementProposal(
  tx: Prisma.TransactionClient,
  lesson: {
    id: string;
    title: string;
    fingerprint: string;
    occurrenceCount: number;
    severity: string;
    proposedPreventionRule: string | null;
  },
  now: Date,
) {
  const director = await tx.employee.findUnique({ where: { id: "director" }, select: { id: true } });
  if (!director) return null;

  const approvalId = `approval-learning-${randomUUID()}`;
  const preventionRule = lesson.proposedPreventionRule ?? "근본 원인과 안전 정지 조건을 확인하고 회귀 테스트를 추가합니다.";
  await tx.approvalRequest.create({
    data: {
      id: approvalId,
      title: `[운영 개선] ${lesson.title}`,
      requestedByEmployeeId: director.id,
      taskId: null,
      approvalType: "운영 개선",
      riskLevel: lesson.severity === "critical" || lesson.severity === "high" ? "높음" : "보통",
      estimatedCost: null,
      status: "승인 대기",
      reason: `7일 안에 같은 실패가 반복되었습니다. fingerprint: ${lesson.fingerprint}`,
      plannedAction: preventionRule,
      expectedResult: "승인된 예방 규칙만 관련 Agent 실행에 적용하고 재발 여부를 추적합니다.",
    },
  });
  const event = await tx.eventLog.create({
    data: {
      id: `event-${randomUUID()}`,
      type: "OperationalImprovementProposed",
      timestamp: now,
      employeeId: director.id,
      approvalId,
      payload: {
        operationalLessonId: lesson.id,
        fingerprint: lesson.fingerprint,
        occurrenceCount: lesson.occurrenceCount,
        proposedPreventionRule: preventionRule,
      },
      summary: `${lesson.title} · 반복 실패 개선안 승인 요청`,
    },
  });
  await tx.timeline.createMany({
    data: [
      {
        id: `timeline-${randomUUID()}`,
        targetType: "approval",
        targetId: approvalId,
        eventId: event.id,
        title: "반복 실패 개선안",
        description: preventionRule,
        timestamp: now,
      },
      {
        id: `timeline-${randomUUID()}`,
        targetType: "operational-lesson",
        targetId: lesson.id,
        eventId: event.id,
        title: "루나 개선 제안",
        description: `${lesson.fingerprint} · 누적 ${lesson.occurrenceCount}회`,
        timestamp: now,
      },
    ],
  });
  return approvalId;
}

export async function recordOperationalFailure(input: OperationalFailureInput) {
  const classification = classifyOperationalFailure(input);
  const occurredAt = input.occurredAt ?? new Date();
  const payload = asRecord(input.payload);

  try {
    return await prisma.$transaction(async (tx) => {
      const duplicate = await tx.operationalFailureOccurrence.findUnique({
        where: { occurrenceKey: classification.occurrenceKey },
        include: { lesson: true },
      });
      if (duplicate) return { lesson: duplicate.lesson, occurrence: duplicate, proposalCreated: false, duplicate: true };

      const existing = await tx.operationalLesson.findUnique({ where: { fingerprint: classification.fingerprint } });
      const lesson = existing
        ? await tx.operationalLesson.update({
          where: { id: existing.id },
          data: {
            lastSeenAt: occurredAt,
            occurrenceCount: { increment: 1 },
            severity: classification.severity,
            agentId: existing.agentId ?? classification.ownerAgentId,
            proposedPreventionRule: existing.proposedPreventionRule ?? classification.proposedPreventionRule,
            ...(existing.status === "verified" ? { status: "prevented", verifiedAt: null } : {}),
          },
        })
        : await tx.operationalLesson.create({
          data: {
            fingerprint: classification.fingerprint,
            title: classification.title,
            area: classification.area,
            stage: classification.stage,
            agentId: classification.ownerAgentId,
            severity: classification.severity,
            status: initialLessonStatus(classification.stage),
            approvalStatus: "not_requested",
            occurrenceCount: 1,
            firstSeenAt: occurredAt,
            lastSeenAt: occurredAt,
            proposedPreventionRule: classification.proposedPreventionRule,
          },
        });

      const occurrence = await tx.operationalFailureOccurrence.create({
        data: {
          lessonId: lesson.id,
          occurrenceKey: classification.occurrenceKey,
          sourceEventId: input.sourceEventId,
          correlationId: classification.correlationId,
          occurredAt,
          errorCode: classification.errorCode,
          message: classification.message,
          metadata: safeFailureMetadata(payload),
        },
      });

      const recent = await tx.operationalFailureOccurrence.findMany({
        where: { lessonId: lesson.id, occurredAt: { gte: new Date(occurredAt.getTime() - 7 * 24 * 60 * 60 * 1000), lte: occurredAt } },
        select: { occurredAt: true },
      });
      const recentDates = recent.map((item) => item.occurredAt);
      const postApprovalDates = lesson.approvedAt
        ? recentDates.filter((date) => date.getTime() > lesson.approvedAt!.getTime())
        : [];
      const firstProposalRequired = lesson.approvalStatus !== "pending"
        && lesson.approvalStatus !== "approved"
        && shouldCreateImprovementProposal(recentDates, occurredAt);
      const approvedRuleReviewRequired = lesson.approvalStatus === "approved"
        && shouldCreateImprovementProposal(postApprovalDates, occurredAt);
      const eligibleForProposal = firstProposalRequired || approvedRuleReviewRequired;
      const approvalId = eligibleForProposal ? await createImprovementProposal(tx, lesson, occurredAt) : null;
      const updatedLesson = approvalId
        ? await tx.operationalLesson.update({
          where: { id: lesson.id },
          data: { approvalId, approvalStatus: "pending", improvementProposalAt: occurredAt },
        })
        : lesson;
      return { lesson: updatedLesson, occurrence, proposalCreated: Boolean(approvalId), duplicate: false };
    });
  } catch (error: unknown) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const occurrence = await prisma.operationalFailureOccurrence.findUnique({
        where: { occurrenceKey: classification.occurrenceKey },
        include: { lesson: true },
      });
      if (occurrence) return { lesson: occurrence.lesson, occurrence, proposalCreated: false, duplicate: true };
    }
    throw error;
  }
}

export async function recordFailureFromPersistedEvent(event: {
  id: string;
  type: string;
  timestamp: Date;
  employeeId: string | null;
  taskId: string | null;
  payload: Prisma.JsonValue;
  summary: string | null;
}) {
  if (!isOperationalFailureEvent(event)) return null;
  return recordOperationalFailure({
    sourceEventId: event.id,
    eventType: event.type,
    employeeId: event.employeeId,
    taskId: event.taskId,
    occurredAt: event.timestamp,
    summary: event.summary,
    payload: asRecord(event.payload),
  });
}

export async function applyOperationalLessonApproval(
  tx: Prisma.TransactionClient,
  input: { approvalId: string; status: "승인 완료" | "반려" | "수정 요청" | "보류"; decisionReason?: string },
) {
  const lesson = await tx.operationalLesson.findUnique({ where: { approvalId: input.approvalId } });
  if (!lesson) return null;
  const now = new Date();
  if (input.status === "승인 완료") {
    return tx.operationalLesson.update({
      where: { id: lesson.id },
      data: {
        approvalStatus: "approved",
        status: "prevented",
        preventionRule: lesson.preventionRule ?? lesson.proposedPreventionRule,
        approvedAt: now,
        rejectedAt: null,
      },
    });
  }
  if (input.status === "반려") {
    return tx.operationalLesson.update({
      where: { id: lesson.id },
      data: { approvalStatus: "rejected", status: "contained", rejectedAt: now },
    });
  }
  return tx.operationalLesson.update({
    where: { id: lesson.id },
    data: { approvalStatus: "pending", status: "contained" },
  });
}

export async function listOperationalLessons() {
  return prisma.operationalLesson.findMany({
    orderBy: [{ lastSeenAt: "desc" }, { occurrenceCount: "desc" }],
    include: { occurrences: { orderBy: { occurredAt: "desc" }, take: 10 } },
  });
}

export async function updateOperationalLesson(input: {
  lessonId: string;
  title?: string;
  agentId?: string | null;
  rootCause?: string | null;
  preventionRule?: string | null;
  regressionTest?: string | null;
  verificationEvidence?: string | null;
  policyVersion?: string | null;
  status?: "observed" | "contained" | "prevented" | "verified" | "archived";
}) {
  const existing = await prisma.operationalLesson.findUniqueOrThrow({ where: { id: input.lessonId } });
  const merged = {
    approvalStatus: existing.approvalStatus,
    preventionRule: input.preventionRule === undefined ? existing.preventionRule : input.preventionRule,
    regressionTest: input.regressionTest === undefined ? existing.regressionTest : input.regressionTest,
    verificationEvidence: input.verificationEvidence === undefined ? existing.verificationEvidence : input.verificationEvidence,
  };
  if (input.status === "verified") {
    const errors = operationalLessonVerificationErrors(merged);
    if (errors.length > 0) throw new Error(`OPERATIONAL_LESSON_VERIFICATION_BLOCKED: ${errors.join(" ")}`);
  }
  return prisma.operationalLesson.update({
    where: { id: input.lessonId },
    data: {
      ...(input.title !== undefined ? { title: input.title.trim() } : {}),
      ...(input.agentId !== undefined ? { agentId: input.agentId } : {}),
      ...(input.rootCause !== undefined ? { rootCause: input.rootCause } : {}),
      ...(input.preventionRule !== undefined ? { preventionRule: input.preventionRule } : {}),
      ...(input.regressionTest !== undefined ? { regressionTest: input.regressionTest } : {}),
      ...(input.verificationEvidence !== undefined ? { verificationEvidence: input.verificationEvidence } : {}),
      ...(input.policyVersion !== undefined ? { policyVersion: input.policyVersion } : {}),
      ...(input.status !== undefined ? { status: input.status, verifiedAt: input.status === "verified" ? new Date() : null } : {}),
    },
    include: { occurrences: { orderBy: { occurredAt: "desc" }, take: 10 } },
  });
}

export async function loadApprovedLessonInstructions(input: { agentId: string; area?: string }): Promise<OperationalLessonInstruction[]> {
  const lessons = await prisma.operationalLesson.findMany({
    where: {
      approvalStatus: "approved",
      status: { in: ["prevented", "verified"] },
      preventionRule: { not: null },
      OR: [{ agentId: input.agentId }, { agentId: null }],
    },
    select: {
      id: true,
      fingerprint: true,
      title: true,
      area: true,
      agentId: true,
      status: true,
      approvalStatus: true,
      preventionRule: true,
      policyVersion: true,
      updatedAt: true,
    },
    orderBy: { updatedAt: "desc" },
    take: 20,
  });
  return selectApplicableLessonInstructions(lessons, input);
}

export async function loadApprovedLessonInstructionsForAgents(input: { agentIds: string[]; area?: string }) {
  const entries = await Promise.all(input.agentIds.map(async (agentId) => [
    agentId,
    await loadApprovedLessonInstructions({ agentId, area: input.area }),
  ] as const));
  return Object.fromEntries(entries) as Record<string, OperationalLessonInstruction[]>;
}
