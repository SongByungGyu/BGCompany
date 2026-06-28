import { NextResponse } from "next/server";
import {
  ADMIN_SESSION_COOKIE,
  ADMIN_SESSION_MAX_AGE_SECONDS,
  createAdminSessionToken,
  getAdminPasswordConfigured,
  verifyAdminPassword,
} from "@/lib/auth/admin-auth";

export async function POST(request: Request) {
  if (!getAdminPasswordConfigured()) {
    return NextResponse.json({ ok: false, message: "Admin login is not configured." }, { status: 500 });
  }

  const body = await request.json().catch(() => null) as { password?: unknown } | null;
  const password = typeof body?.password === "string" ? body.password : "";

  if (!verifyAdminPassword(password)) {
    return NextResponse.json({ ok: false, message: "관리자 비밀번호가 올바르지 않습니다." }, { status: 401 });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set({
    httpOnly: true,
    maxAge: ADMIN_SESSION_MAX_AGE_SECONDS,
    name: ADMIN_SESSION_COOKIE,
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    value: await createAdminSessionToken(),
  });
  return response;
}
