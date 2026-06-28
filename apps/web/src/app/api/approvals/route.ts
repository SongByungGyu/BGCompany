import { NextResponse } from "next/server";
import { requireAdminApiSession } from "@/lib/auth/admin-auth";
import { listApprovals } from "@/lib/repositories/approvals";

export async function GET(request: Request) {
  const auth = await requireAdminApiSession(request);
  if (!auth.ok) return auth.response;

  const approvals = await listApprovals();
  return NextResponse.json({ approvals });
}
