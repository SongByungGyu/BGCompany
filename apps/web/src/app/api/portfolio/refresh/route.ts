import { NextResponse } from "next/server";
import { authorizePortfolioApi } from "@/lib/portfolio/portfolio-api";
import { assertRefreshRateLimit, refreshPortfolio } from "@/lib/portfolio/portfolio-service";
import { errorMessage } from "@/lib/portfolio/portfolio-validation";

export async function POST(request: Request) {
  const denied = await authorizePortfolioApi(request, true);
  if (denied) return denied;
  try {
    const clientKey = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "admin";
    assertRefreshRateLimit(clientKey);
    const body = await request.json().catch(() => ({})) as { accountId?: string };
    return NextResponse.json(await refreshPortfolio(body.accountId));
  } catch (error) {
    const status = error instanceof Error && error.message === "REFRESH_RATE_LIMITED" ? 429 : 400;
    return NextResponse.json({ error: status === 429 ? "새로고침은 1분에 3회까지 가능합니다." : errorMessage(error) }, { status });
  }
}

