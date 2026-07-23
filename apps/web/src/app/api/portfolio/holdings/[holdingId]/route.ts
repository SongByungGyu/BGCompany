import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { authorizePortfolioApi } from "@/lib/portfolio/portfolio-api";
import { errorMessage, parseHoldingInput } from "@/lib/portfolio/portfolio-validation";

export async function PATCH(request: Request, context: RouteContext<"/api/portfolio/holdings/[holdingId]">) {
  const denied = await authorizePortfolioApi(request, true);
  if (denied) return denied;
  try {
    const { holdingId } = await context.params;
    const current = await prisma.portfolioHolding.findUnique({ where: { id: holdingId } });
    if (!current) return NextResponse.json({ error: "보유 종목을 찾을 수 없습니다." }, { status: 404 });
    const input = parseHoldingInput(await request.json(), true);
    if (input.portfolioAccountId) {
      const target = await prisma.portfolioAccount.findFirst({ where: { id: String(input.portfolioAccountId), isActive: true } });
      if (!target) return NextResponse.json({ error: "이동할 계좌를 찾을 수 없습니다." }, { status: 404 });
    }
    const before = {
      portfolioAccountId: current.portfolioAccountId,
      quantity: current.quantity.toString(),
      averagePrice: current.averagePrice.toString(),
      sector: current.sector,
      note: current.note,
      dividendTrackingEnabled: current.dividendTrackingEnabled,
      isActive: current.isActive,
    };
    const updated = await prisma.$transaction(async (tx) => {
      const holding = await tx.portfolioHolding.update({ where: { id: holdingId }, data: input });
      await tx.portfolioHoldingChange.create({
        data: {
          portfolioAccountId: holding.portfolioAccountId,
          holdingId,
          changeType: holding.isActive ? "updated" : "deactivated",
          before,
          after: {
            portfolioAccountId: holding.portfolioAccountId,
            quantity: holding.quantity.toString(),
            averagePrice: holding.averagePrice.toString(),
            sector: holding.sector,
            note: holding.note,
            dividendTrackingEnabled: holding.dividendTrackingEnabled,
            isActive: holding.isActive,
          },
        },
      });
      return holding;
    });
    return NextResponse.json({ holding: { ...updated, quantity: updated.quantity.toString(), averagePrice: updated.averagePrice.toString() } });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 400 });
  }
}
