import { NextResponse } from "next/server";
import { authorizePortfolioApi } from "@/lib/portfolio/portfolio-api";
import { assertRefreshRateLimit, syncTossPortfolioAccount } from "@/lib/portfolio/portfolio-service";
import { errorMessage } from "@/lib/portfolio/portfolio-validation";

export async function POST(request: Request) {
  const denied = await authorizePortfolioApi(request, true);
  if (denied) return denied;
  try {
    const clientKey = `account-sync:${request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "admin"}`;
    assertRefreshRateLimit(clientKey);
    return NextResponse.json(await syncTossPortfolioAccount());
  } catch (error) {
    const message = errorMessage(error);
    const status = message === "REFRESH_RATE_LIMITED" ? 429 : 400;
    return NextResponse.json({
      error: status === 429 ? "실계좌 동기화는 1분에 3회까지 가능합니다." : message,
    }, { status });
  }
}
