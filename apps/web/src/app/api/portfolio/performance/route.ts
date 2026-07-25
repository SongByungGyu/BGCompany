import { authorizePortfolioApi, noStoreJson } from "@/lib/portfolio/portfolio-api";
import { getPortfolioPerformance } from "@/lib/portfolio/portfolio-daily-assistant-service";
import type { PortfolioPerformanceResponse } from "@/lib/portfolio/portfolio-daily-assistant-types";

const ranges = new Set<PortfolioPerformanceResponse["range"]>(["7d", "30d", "3m", "ytd", "all"]);

export async function GET(request: Request) {
  const denied = await authorizePortfolioApi(request);
  if (denied) return denied;
  const url = new URL(request.url);
  const requested = url.searchParams.get("range") as PortfolioPerformanceResponse["range"] | null;
  const range = requested && ranges.has(requested) ? requested : "30d";
  return noStoreJson(await getPortfolioPerformance(range, url.searchParams.get("accountId")));
}
