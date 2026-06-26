import { NextResponse } from "next/server";
import { listApprovals } from "@/lib/repositories/approvals";

export async function GET() {
  const approvals = await listApprovals();
  return NextResponse.json({ approvals });
}
