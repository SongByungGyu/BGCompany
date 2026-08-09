import { NextResponse } from "next/server";
import { authorizePortfolioApi, noStoreJson } from "@/lib/portfolio/portfolio-api";
import { runPaperTradingCycle } from "@/lib/portfolio/paper-trading-service";
import type { PaperTradingCycleInput } from "@/lib/portfolio/paper-trading-types";

export async function POST(request: Request) {
  const denied = await authorizePortfolioApi(request, true);
  if (denied) return denied;
  try {
    const body = await request.json() as PaperTradingCycleInput;
    return noStoreJson(await runPaperTradingCycle(body));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "모의투자 실행에 실패했습니다." }, { status: 400 });
  }
}
