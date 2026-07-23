import { authorizePortfolioApi, noStoreJson } from "@/lib/portfolio/portfolio-api";
import { getPortfolioDashboard } from "@/lib/portfolio/portfolio-service";

export async function GET(request: Request) {
  const denied = await authorizePortfolioApi(request);
  if (denied) return denied;
  const dashboard = await getPortfolioDashboard(new URL(request.url).searchParams.get("accountId"));
  return noStoreJson({ generatedAt: dashboard.generatedAt, dataAsOf: dashboard.dataAsOf, summary: dashboard.summary, holdings: dashboard.holdings, allocations: dashboard.allocations });
}
