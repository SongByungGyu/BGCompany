import { randomUUID } from "node:crypto";
import type { ApprovalRequest, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { serializeApproval, serializeEvent, serializeTimeline } from "./serializers";

type ApprovalActionStatus = "승인 완료" | "반려" | "수정 요청" | "보류";

function decisionFromStatus(status: ApprovalActionStatus) {
  if (status === "승인 완료") return "approved";
  if (status === "반려") return "rejected";
  if (status === "수정 요청") return "revision_requested";
  return "on_hold";
}

function employeeStatusFromDecision(status: ApprovalActionStatus) {
  if (status === "승인 완료") return "업무 완료";
  if (status === "보류") return "대기 중";
  return "수정 중";
}

function taskStatusFromDecision(status: ApprovalActionStatus) {
  if (status === "승인 완료") return "완료";
  if (status === "보류") return "대기";
  return "진행 중";
}

function eventPayload(approval: ApprovalRequest, status: ApprovalActionStatus, decisionReason?: string): Prisma.InputJsonObject {
  return {
    approvalId: approval.id,
    title: approval.title,
    status,
    decision: decisionFromStatus(status),
    approved: status === "승인 완료",
    comment: decisionReason ?? "",
  };
}

export async function resolveApproval(input: {
  approvalId: string;
  status: ApprovalActionStatus;
  decisionReason?: string;
}) {
  return prisma.$transaction(async (tx) => {
    await tx.approvalRequest.findUniqueOrThrow({ where: { id: input.approvalId } });
    const decidedAt = new Date();
    const approval = await tx.approvalRequest.update({
      where: { id: input.approvalId },
      data: {
        status: input.status,
        decision: decisionFromStatus(input.status),
        decisionReason: input.decisionReason ?? null,
        decidedAt,
      },
    });
    if (approval.taskId) {
      await tx.task.update({
        where: { id: approval.taskId },
        data: { status: taskStatusFromDecision(input.status) },
      }).catch(() => null);
    }
    await tx.employee.update({
      where: { id: approval.requestedByEmployeeId },
      data: { status: employeeStatusFromDecision(input.status) },
    }).catch(() => null);

    const event = await tx.eventLog.create({
      data: {
        id: `event-${randomUUID()}`,
        type: "ApprovalResolved",
        timestamp: decidedAt,
        employeeId: approval.requestedByEmployeeId,
        taskId: approval.taskId,
        approvalId: approval.id,
        payload: eventPayload(approval, input.status, input.decisionReason),
        summary: `${approval.title} · ${input.status}`,
      },
    });
    const timelineTargets = [
      { targetType: "approval", targetId: approval.id },
      approval.taskId ? { targetType: "task", targetId: approval.taskId } : null,
      { targetType: "employee", targetId: approval.requestedByEmployeeId },
    ].filter((target): target is { targetType: string; targetId: string } => Boolean(target));
    const timelines = await Promise.all(timelineTargets.map((target) => tx.timeline.create({
      data: {
        id: `timeline-${randomUUID()}`,
        targetType: target.targetType,
        targetId: target.targetId,
        eventId: event.id,
        title: input.status,
        description: input.decisionReason || `${approval.title} 처리`,
        timestamp: decidedAt,
      },
    })));
    return {
      approval: serializeApproval(approval),
      event: serializeEvent(event),
      timeline: serializeTimeline(timelines[0]),
    };
  });
}
