import { authorizePortfolioApi, noStoreJson } from "@/lib/portfolio/portfolio-api";
import { getPortfolioDailyAssistant } from "@/lib/portfolio/portfolio-daily-assistant-service";

export async function GET(request: Request) {
  const denied = await authorizePortfolioApi(request);
  if (denied) return denied;
  const assistant = await getPortfolioDailyAssistant(new URL(request.url).searchParams.get("accountId"));
  return noStoreJson({ enabled: assistant.enabled, changes: assistant.enabled ? assistant.changes : [], message: assistant.enabled ? undefined : assistant.message });
}
