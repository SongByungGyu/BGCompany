import { NextRequest, NextResponse } from "next/server";
import { requireAdminApiSession } from "@/lib/auth/admin-auth";
import {
  getStockBlogSchedulerStatus,
  runStockBlogSchedulerRecovery,
  runStockBlogSchedulerTick,
  verifyStockBlogSchedulerKey,
} from "@/lib/stock-blog/stock-blog-scheduler";

export async function GET(request: NextRequest) {
  const auth = await requireAdminApiSession(request);
  if (!auth.ok) return auth.response;
  const status = await getStockBlogSchedulerStatus();
  return NextResponse.json(status);
}

export async function POST(request: NextRequest) {
  const agentKey = request.headers.get("x-bg-agent-key");
  if (!verifyStockBlogSchedulerKey(agentKey)) {
    const auth = await requireAdminApiSession(request);
    if (!auth.ok) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const queryScheduleId = request.nextUrl.searchParams.get("scheduleId")?.trim() ?? "";
  const body = queryScheduleId ? null : await request.json().catch(() => null) as {
    scheduleId?: unknown;
  } | null;
  const scheduleId = queryScheduleId || (
    typeof body?.scheduleId === "string" ? body.scheduleId.trim() : ""
  );
  const result = scheduleId
    ? await runStockBlogSchedulerRecovery(scheduleId)
    : await runStockBlogSchedulerTick();
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
