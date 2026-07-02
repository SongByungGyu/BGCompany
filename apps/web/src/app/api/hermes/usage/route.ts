import { NextResponse } from "next/server";

import { requireAdminApiSession } from "@/lib/auth/admin-auth";
import { getHermesUsageSummary } from "@/lib/hermes/hermes-usage";

export async function GET(request: Request) {
  const session = await requireAdminApiSession(request);
  if (!session.ok) return session.response;

  try {
    const usage = await getHermesUsageSummary();
    return NextResponse.json(usage);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Hermes usage error";
    return NextResponse.json({ ok: false, error: "HERMES_USAGE_FAILED", message }, { status: 500 });
  }
}
