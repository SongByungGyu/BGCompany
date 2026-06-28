import { NextResponse } from "next/server";
import { requireAdminApiSession } from "@/lib/auth/admin-auth";
import { listTasks } from "@/lib/repositories/tasks";

export async function GET(request: Request) {
  const auth = await requireAdminApiSession(request);
  if (!auth.ok) return auth.response;

  const tasks = await listTasks();
  return NextResponse.json({ tasks });
}
