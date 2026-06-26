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
  return serializeEvent(event);
}
