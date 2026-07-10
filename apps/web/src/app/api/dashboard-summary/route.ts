import { NextResponse } from "next/server";
import { requireAdminApiSession } from "@/lib/auth/admin-auth";
import { buildDashboardSummary } from "@/lib/dashboard-summary/dashboard-summary-service";

export async function GET(request: Request) {
  const auth = await requireAdminApiSession(request);
  if (!auth.ok) return auth.response;

  try {
    const summary = await buildDashboardSummary();
    return NextResponse.json(summary);
  } catch (error) {
    console.error("[dashboard-summary] failed to build summary", error);
    return NextResponse.json({ error: "DASHBOARD_SUMMARY_FAILED" }, { status: 500 });
  }
}
