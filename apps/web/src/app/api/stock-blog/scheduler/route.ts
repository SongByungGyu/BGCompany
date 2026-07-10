import { NextRequest, NextResponse } from "next/server";
import { requireAdminApiSession } from "@/lib/auth/admin-auth";
import {
  getStockBlogSchedulerStatus,
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
  const result = await runStockBlogSchedulerTick();
  return NextResponse.json(result);
}
