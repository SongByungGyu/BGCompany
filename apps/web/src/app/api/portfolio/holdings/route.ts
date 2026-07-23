import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { authorizePortfolioApi } from "@/lib/portfolio/portfolio-api";
import { portfolioConfig } from "@/lib/portfolio/portfolio-config";
import { errorMessage, parseHoldingInput } from "@/lib/portfolio/portfolio-validation";

export async function POST(request: Request) {
  const denied = await authorizePortfolioApi(request, true);
  if (denied) return denied;
  try {
    const input = parseHoldingInput(await request.json());
    const account = await prisma.portfolioAccount.findFirst({ where: { id: input.portfolioAccountId, isActive: true } });
    if (!account) return NextResponse.json({ error: "활성 계좌를 찾을 수 없습니다." }, { status: 404 });
    const count = await prisma.portfolioHolding.count({ where: { portfolioAccountId: account.id, isActive: true } });
    if (count >= portfolioConfig().maxSymbols) return NextResponse.json({ error: "보유 종목 한도를 초과했습니다." }, { status: 409 });
    const holding = await prisma.$transaction(async (tx) => {
      const created = await tx.portfolioHolding.create({ data: input });
      await tx.portfolioHoldingChange.create({
        data: { portfolioAccountId: account.id, holdingId: created.id, changeType: "created", after: input },
      });
      return created;
    });
    return NextResponse.json({ holding: { ...holding, quantity: holding.quantity.toString(), averagePrice: holding.averagePrice.toString() } }, { status: 201 });
  } catch (error) {
    const status = error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002" ? 409 : 400;
    return NextResponse.json({ error: status === 409 ? "같은 계좌에 이미 등록된 종목입니다." : errorMessage(error) }, { status });
  }
}

