import { authorizePortfolioApi, noStoreJson } from "@/lib/portfolio/portfolio-api";
import { getPortfolioDailyAssistant } from "@/lib/portfolio/portfolio-daily-assistant-service";

export async function GET(request: Request) {
  const denied = await authorizePortfolioApi(request);
  if (denied) return denied;
  const accountId = new URL(request.url).searchParams.get("accountId");
  return noStoreJson(await getPortfolioDailyAssistant(accountId));
}
