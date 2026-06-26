import { NextResponse } from "next/server";
import { listTasks } from "@/lib/repositories/tasks";

export async function GET() {
  const tasks = await listTasks();
  return NextResponse.json({ tasks });
}
