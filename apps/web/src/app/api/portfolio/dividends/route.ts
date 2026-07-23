import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { authorizePortfolioApi, noStoreJson } from "@/lib/portfolio/portfolio-api";
import { getPortfolioDashboard } from "@/lib/portfolio/portfolio-service";
import { errorMessage, parseDividendInput } from "@/lib/portfolio/portfolio-validation";

export async function GET(request: Request) {
  const denied = await authorizePortfolioApi(request);
  if (denied) return denied;
  const dashboard = await getPortfolioDashboard(new URL(request.url).searchParams.get("accountId"));
  return noStoreJson({ dividends: dashboard.dividends });
}

export async function POST(request: Request) {
  const denied = await authorizePortfolioApi(request, true);
  if (denied) return denied;
  try {
    const input = parseDividendInput(await request.json());
    const event = await prisma.dividendEvent.create({ data: input });
    return NextResponse.json({ event: { ...event, amountPerShare: event.amountPerShare?.toString() ?? null } }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 400 });
  }
}
