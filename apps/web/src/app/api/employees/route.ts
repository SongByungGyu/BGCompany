import { NextResponse } from "next/server";
import { requireAdminApiSession } from "@/lib/auth/admin-auth";
import { listEmployees } from "@/lib/repositories/employees";

export async function GET(request: Request) {
  const auth = await requireAdminApiSession(request);
  if (!auth.ok) return auth.response;

  const employees = await listEmployees();
  return NextResponse.json({ employees });
}
