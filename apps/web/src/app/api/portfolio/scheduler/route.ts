import { NextRequest, NextResponse } from "next/server";
import { requireAdminApiSession } from "@/lib/auth/admin-auth";
import { executeDailyPortfolioSync } from "@/lib/portfolio/portfolio-daily-sync";
import {
  getPortfolioAutoSyncStatus,
  runPortfolioAutoSyncTick,
  verifyPortfolioAutoSyncKey,
} from "@/lib/portfolio/portfolio-sync-scheduler";

export async function GET(request: NextRequest) {
  const auth = await requireAdminApiSession(request);
  if (!auth.ok) return auth.response;
  return NextResponse.json(await getPortfolioAutoSyncStatus());
}

export async function POST(request: NextRequest) {
  if (!verifyPortfolioAutoSyncKey(request.headers.get("x-bg-agent-key"))) {
    const auth = await requireAdminApiSession(request);
    if (!auth.ok) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const result = await runPortfolioAutoSyncTick(executeDailyPortfolioSync);
  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}
