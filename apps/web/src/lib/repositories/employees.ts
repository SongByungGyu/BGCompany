import { prisma } from "@/lib/db";
import { serializeEmployee, serializeTask } from "./serializers";

export async function listEmployees() {
  const employees = await prisma.employee.findMany({ orderBy: { displayName: "asc" } });
  const currentTaskIds = employees.flatMap((employee) => employee.currentTaskId ? [employee.currentTaskId] : []);
  const activeTasks = await prisma.task.findMany({
    where: {
      OR: [
        { id: { in: currentTaskIds } },
        {
          assignedEmployeeId: { in: employees.map((employee) => employee.id) },
          status: { in: ["대기", "진행 중", "승인 대기", "오류"] },
        },
      ],
    },
    orderBy: { updatedAt: "desc" },
  });
  const currentTaskByEmployeeId = new Map<string, (typeof activeTasks)[number]>();
  const taskById = new Map(activeTasks.map((task) => [task.id, task]));
  for (const employee of employees) {
    const currentTask = employee.currentTaskId ? taskById.get(employee.currentTaskId) : undefined;
    if (currentTask) currentTaskByEmployeeId.set(employee.id, currentTask);
  }
  for (const task of activeTasks) {
    if (task.assignedEmployeeId && !currentTaskByEmployeeId.has(task.assignedEmployeeId)) {
      currentTaskByEmployeeId.set(task.assignedEmployeeId, task);
    }
  }

  return employees.map((employee) => ({
    ...serializeEmployee(employee),
    currentTask: currentTaskByEmployeeId.has(employee.id)
      ? serializeTask(currentTaskByEmployeeId.get(employee.id)!)
      : null,
  }));
}
