import type { ApprovalRequest, Employee, EventLog, Prisma, Task, Timeline } from "@prisma/client";

function decimalToString(value: Prisma.Decimal | null) {
  return value ? value.toString() : null;
}

export function serializeEmployee(employee: Employee) {
  return {
    ...employee,
    currentCost: decimalToString(employee.currentCost),
  };
}

export function serializeTask(task: Task) {
  return {
    ...task,
    cost: decimalToString(task.cost),
  };
}

export function serializeApproval(approval: ApprovalRequest) {
  return {
    ...approval,
    estimatedCost: decimalToString(approval.estimatedCost),
  };
}

export function serializeEvent(event: EventLog) {
  return event;
}

export function serializeTimeline(timeline: Timeline) {
  return timeline;
}
