import { prisma } from "@/lib/db";
import { serializeTask } from "./serializers";

export async function listTasks() {
  const tasks = await prisma.task.findMany({
    orderBy: [{ updatedAt: "desc" }, { startedAt: "desc" }],
  });
  return tasks.map(serializeTask);
}
