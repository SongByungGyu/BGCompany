import { prisma } from "@/lib/db";
import { serializeEmployee } from "./serializers";

export async function listEmployees() {
  const employees = await prisma.employee.findMany({ orderBy: { displayName: "asc" } });
  return employees.map(serializeEmployee);
}
