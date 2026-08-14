import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { recordFailureFromPersistedEvent } from "@/lib/operational-learning/operational-learning-service";
import { serializeEvent } from "./serializers";

export async function listEvents() {
  const events = await prisma.eventLog.findMany({
    orderBy: { timestamp: "desc" },
    take: 100,
  });
  return events.map(serializeEvent);
}

function statusFromPayload(payload: Record<string, unknown>, fallback?: string | null) {
  return typeof payload.status === "string" ? payload.status : fallback ?? undefined;
}

function taskStatusFromEmployeeStatus(status?: string) {
  if (!status) return undefined;
  if (status === "오류 대응 중") return "오류";
  if (status === "업무 완료") return "완료";
  if (status === "승인 대기") return "승인 대기";
  if (status === "대기 중" || status === "업무 종료") return "대기";
  return "진행 중";
}

const homeLocationByEmployeeId: Record<string, string> = {
  director: "director-seat",
  "content-planner": "content-seat-01",
  "marketing-manager": "content-seat-02",
  "content-writer": "content-seat-03",
  "finance-manager": "finance-seat-01",
  "stock-monitor": "stock-seat-01",
  "risk-trader": "stock-seat-02",
  "execution-trader": "stock-seat-03",
  developer: "dev-seat-01",
  "qa-auditor": "audit-seat-01",
  "local-publisher": "publishing-station-point",
};

function locationForStatus(employeeId: string, status?: string) {
  if (status === "회의 중") return employeeId === "director" ? "meeting-seat-02" : undefined;
  if (status === "승인 대기") return "approval-wait-point";
  if (status === "보고 중") return "director-report-point";
  if (status === "오류 대응 중") return "error-response-point";
  if (status === "휴식 중") return "break-seat-02";
  if (status === "업무 종료") return "entrance-point";
  return homeLocationByEmployeeId[employeeId];
}

async function applyEventSideEffects(event: { type: string; employeeId: string | null; taskId: string | null; approvalId: string | null; payload: Prisma.JsonValue }) {
  const payload = typeof event.payload === "object" && event.payload !== null && !Array.isArray(event.payload) ? event.payload as Record<string, unknown> : {};
  const status = statusFromPayload(payload);
  if (event.type === "EmployeeStatusChanged" && event.employeeId && status) {
    await prisma.employee.update({
      where: { id: event.employeeId },
      data: {
        status,
        currentLocation: locationForStatus(event.employeeId, status),
        ...(status === "업무 완료" || status === "업무 종료" ? { currentTaskId: null } : {}),
      },
    }).catch(() => null);
    const taskStatus = taskStatusFromEmployeeStatus(status);
    if (event.taskId && taskStatus) await prisma.task.update({ where: { id: event.taskId }, data: { status: taskStatus } }).catch(() => null);
  }
  if (event.type === "TaskStarted" && event.taskId) {
    await prisma.task.update({
      where: { id: event.taskId },
      data: { status: "진행 중", startedAt: new Date(), completedAt: null, progress: { set: 5 } },
    }).catch(() => null);
    if (event.employeeId) await prisma.employee.update({
      where: { id: event.employeeId },
      data: { status: "업무 중", currentTaskId: event.taskId, currentLocation: locationForStatus(event.employeeId, "업무 중") },
    }).catch(() => null);
  }
  if (event.type === "MeetingStarted") {
    if (event.employeeId) await prisma.employee.update({ where: { id: event.employeeId }, data: { status: "회의 중", currentLocation: locationForStatus(event.employeeId, "회의 중") } }).catch(() => null);
  }
  if (event.type === "MeetingEnded") {
    const nextStatus = statusFromPayload(payload, "업무 중");
    if (event.employeeId) await prisma.employee.update({ where: { id: event.employeeId }, data: { status: nextStatus, currentLocation: locationForStatus(event.employeeId, nextStatus) } }).catch(() => null);
  }
  if (event.type === "OutputGenerated" && event.taskId) {
    const nextTaskStatus = taskStatusFromEmployeeStatus(status) ?? "진행 중";
    await prisma.task.update({
      where: { id: event.taskId },
      data: {
        status: nextTaskStatus,
        progress: nextTaskStatus === "완료" || nextTaskStatus === "승인 대기" ? 100 : 90,
        completedAt: nextTaskStatus === "완료" ? new Date() : null,
        recentOutput: typeof payload.output === "string" ? payload.output : typeof payload.outputTitle === "string" ? payload.outputTitle : undefined,
      },
    }).catch(() => null);
  }
  if (event.type === "ErrorOccurred") {
    if (event.taskId) await prisma.task.update({ where: { id: event.taskId }, data: { status: "오류", error: typeof payload.message === "string" ? payload.message : typeof payload.error === "string" ? payload.error : undefined } }).catch(() => null);
    if (event.employeeId) await prisma.employee.update({ where: { id: event.employeeId }, data: { status: "오류 대응 중", currentTaskId: event.taskId, currentLocation: "error-response-point" } }).catch(() => null);
  }
  if (event.type === "ErrorResolved") {
    const nextStatus = statusFromPayload(payload, "업무 중");
    if (event.taskId) await prisma.task.update({ where: { id: event.taskId }, data: { status: taskStatusFromEmployeeStatus(nextStatus) ?? "진행 중", error: null } }).catch(() => null);
    if (event.employeeId) await prisma.employee.update({ where: { id: event.employeeId }, data: { status: nextStatus, currentLocation: locationForStatus(event.employeeId, nextStatus) } }).catch(() => null);
  }
  if (event.type === "ApprovalRequested") {
    if (event.approvalId) await prisma.approvalRequest.update({ where: { id: event.approvalId }, data: { status: "승인 대기" } }).catch(() => null);
    if (event.employeeId) await prisma.employee.update({ where: { id: event.employeeId }, data: { status: "승인 대기", currentTaskId: event.taskId, currentLocation: "approval-wait-point" } }).catch(() => null);
    if (event.taskId) await prisma.task.update({ where: { id: event.taskId }, data: { status: "승인 대기" } }).catch(() => null);
  }
  if (event.type === "ApprovalResolved") {
    const approvalStatus = typeof payload.status === "string" ? payload.status : payload.approved === true ? "승인 완료" : "수정 요청";
    if (event.approvalId) await prisma.approvalRequest.update({ where: { id: event.approvalId }, data: { status: approvalStatus } }).catch(() => null);
    const employeeStatus = approvalStatus === "승인 완료" ? "업무 완료" : approvalStatus === "보류" ? "대기 중" : "수정 중";
    const taskStatus = approvalStatus === "승인 완료" ? "완료" : approvalStatus === "보류" ? "대기" : "진행 중";
    if (event.employeeId) await prisma.employee.update({ where: { id: event.employeeId }, data: { status: employeeStatus, currentTaskId: approvalStatus === "승인 완료" ? null : event.taskId, currentLocation: locationForStatus(event.employeeId, employeeStatus) } }).catch(() => null);
    if (event.taskId) await prisma.task.update({ where: { id: event.taskId }, data: { status: taskStatus, progress: taskStatus === "완료" ? 100 : undefined, completedAt: taskStatus === "완료" ? new Date() : null } }).catch(() => null);
  }
  if (event.type === "EmployeeMoved" && event.employeeId) {
    const location = typeof payload.destinationId === "string"
      ? payload.destinationId
      : typeof payload.currentLocation === "string"
        ? payload.currentLocation
        : typeof payload.location === "string"
          ? payload.location
          : undefined;
    if (location) await prisma.employee.update({ where: { id: event.employeeId }, data: { currentLocation: location } }).catch(() => null);
  }
}

async function createTimelineForEvent(event: { id: string; type: string; timestamp: Date; employeeId: string | null; taskId: string | null; approvalId: string | null; summary: string | null }) {
  const targets = [
    event.approvalId ? { targetType: "approval", targetId: event.approvalId } : null,
    event.taskId ? { targetType: "task", targetId: event.taskId } : null,
    event.employeeId ? { targetType: "employee", targetId: event.employeeId } : null,
  ].filter((target): target is { targetType: string; targetId: string } => Boolean(target));
  const resolvedTargets = targets.length > 0 ? targets : [{ targetType: "global", targetId: "bg-company" }];
  await Promise.all(resolvedTargets.map((target) => prisma.timeline.create({
    data: {
      id: `timeline-${randomUUID()}`,
      targetType: target.targetType,
      targetId: target.targetId,
      eventId: event.id,
      title: event.type,
      description: event.summary,
      timestamp: event.timestamp,
    },
  }).catch(() => null)));
}

export async function createEvent(input: {
  id?: string;
  type: string;
  timestamp?: string;
  employeeId?: string | null;
  taskId?: string | null;
  approvalId?: string | null;
  payload?: Record<string, unknown>;
  summary?: string | null;
}) {
  const event = await prisma.eventLog.create({
    data: {
      id: input.id ?? `event-${randomUUID()}`,
      type: input.type,
      timestamp: input.timestamp ? new Date(input.timestamp) : new Date(),
      employeeId: input.employeeId ?? null,
      taskId: input.taskId ?? null,
      approvalId: input.approvalId ?? null,
      payload: (input.payload ?? {}) as Prisma.InputJsonValue,
      summary: input.summary ?? null,
    },
  });
  await applyEventSideEffects(event);
  await createTimelineForEvent(event);
  await recordFailureFromPersistedEvent(event).catch((error: unknown) => {
    console.error("Operational learning failed after event persistence", error);
  });
  return serializeEvent(event);
}
