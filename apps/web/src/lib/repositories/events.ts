import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
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

async function applyEventSideEffects(event: { type: string; employeeId: string | null; taskId: string | null; approvalId: string | null; payload: Prisma.JsonValue }) {
  const payload = typeof event.payload === "object" && event.payload !== null && !Array.isArray(event.payload) ? event.payload as Record<string, unknown> : {};
  const status = statusFromPayload(payload);
  if (event.type === "EmployeeStatusChanged" && event.employeeId && status) {
    await prisma.employee.update({ where: { id: event.employeeId }, data: { status } }).catch(() => null);
    const taskStatus = taskStatusFromEmployeeStatus(status);
    if (event.taskId && taskStatus) await prisma.task.update({ where: { id: event.taskId }, data: { status: taskStatus } }).catch(() => null);
  }
  if (event.type === "TaskStarted" && event.taskId) {
    await prisma.task.update({ where: { id: event.taskId }, data: { status: "진행 중" } }).catch(() => null);
    if (event.employeeId) await prisma.employee.update({ where: { id: event.employeeId }, data: { status: "업무 중" } }).catch(() => null);
  }
  if (event.type === "OutputGenerated" && event.taskId) {
    await prisma.task.update({
      where: { id: event.taskId },
      data: {
        status: taskStatusFromEmployeeStatus(status) ?? "진행 중",
        recentOutput: typeof payload.output === "string" ? payload.output : undefined,
      },
    }).catch(() => null);
  }
  if (event.type === "ErrorOccurred") {
    if (event.taskId) await prisma.task.update({ where: { id: event.taskId }, data: { status: "오류", error: typeof payload.message === "string" ? payload.message : undefined } }).catch(() => null);
    if (event.employeeId) await prisma.employee.update({ where: { id: event.employeeId }, data: { status: "오류 대응 중" } }).catch(() => null);
  }
  if (event.type === "ErrorResolved") {
    if (event.taskId) await prisma.task.update({ where: { id: event.taskId }, data: { status: taskStatusFromEmployeeStatus(status) ?? "진행 중", error: null } }).catch(() => null);
    if (event.employeeId) await prisma.employee.update({ where: { id: event.employeeId }, data: { status: status ?? "업무 중" } }).catch(() => null);
  }
  if (event.type === "ApprovalRequested" && event.approvalId) {
    await prisma.approvalRequest.update({ where: { id: event.approvalId }, data: { status: "승인 대기" } }).catch(() => null);
  }
}

async function createTimelineForEvent(event: { id: string; type: string; timestamp: Date; employeeId: string | null; taskId: string | null; approvalId: string | null; summary: string | null }) {
  const targetType = event.approvalId ? "approval" : event.taskId ? "task" : event.employeeId ? "employee" : "system";
  const targetId = event.approvalId ?? event.taskId ?? event.employeeId ?? "bg-company";
  await prisma.timeline.create({
    data: {
      id: `timeline-${randomUUID()}`,
      targetType,
      targetId,
      eventId: event.id,
      title: event.type,
      description: event.summary,
      timestamp: event.timestamp,
    },
  }).catch(() => null);
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
  return serializeEvent(event);
}
