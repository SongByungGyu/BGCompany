import "server-only";
import { NextResponse } from "next/server";
import { requireAdminApiSession } from "@/lib/auth/admin-auth";
import { portfolioConfig } from "./portfolio-config";

export async function authorizePortfolioApi(request: Request, mutation = false) {
  const auth = await requireAdminApiSession(request);
  if (!auth.ok) return auth.response;
  if (!portfolioConfig().enabled) {
    return NextResponse.json(
      { enabled: false, message: "포트폴리오 모니터링 기능이 비활성화되어 있습니다." },
      { status: mutation ? 503 : 200 },
    );
  }
  return null;
}

export function noStoreJson(value: unknown, init?: ResponseInit) {
  const response = NextResponse.json(value, init);
  response.headers.set("cache-control", "no-store");
  return response;
}

