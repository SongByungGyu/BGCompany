import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { authorizePortfolioApi } from "@/lib/portfolio/portfolio-api";
import { errorMessage, parseAccountInput } from "@/lib/portfolio/portfolio-validation";

export async function POST(request: Request) {
  const denied = await authorizePortfolioApi(request, true);
  if (denied) return denied;
  try {
    const input = parseAccountInput(await request.json());
    const account = await prisma.portfolioAccount.create({ data: input });
    return NextResponse.json({ account: { ...account, createdAt: account.createdAt.toISOString(), updatedAt: account.updatedAt.toISOString() } }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 400 });
  }
}
