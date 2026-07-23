import { NextResponse } from "next/server";
import { requireAdminApiSession } from "@/lib/auth/admin-auth";
import { buildOperationsOverview } from "@/lib/operations/operations-overview-service";

export async function GET(request: Request) {
  const auth = await requireAdminApiSession(request);
  if (!auth.ok) return auth.response;

  try {
    return NextResponse.json(await buildOperationsOverview());
  } catch (error) {
    console.error("[operations-overview] failed", error);
    return NextResponse.json({ error: "OPERATIONS_OVERVIEW_FAILED" }, { status: 500 });
  }
}
