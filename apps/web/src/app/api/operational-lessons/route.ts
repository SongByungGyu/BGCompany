import { NextResponse } from "next/server";
import { requireAdminApiSession } from "@/lib/auth/admin-auth";
import { listOperationalLessons } from "@/lib/operational-learning/operational-learning-service";

export async function GET(request: Request) {
  const auth = await requireAdminApiSession(request);
  if (!auth.ok) return auth.response;
  const lessons = await listOperationalLessons();
  return NextResponse.json({ lessons });
}
