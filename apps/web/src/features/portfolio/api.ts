import type { PortfolioDashboard, PortfolioResponse } from "@/lib/portfolio/portfolio-types";
import type { PortfolioDailyAssistantDisabled, PortfolioDailyAssistantView, PortfolioPerformanceResponse } from "@/lib/portfolio/portfolio-daily-assistant-types";
import type { PaperTradingResponse } from "@/lib/portfolio/paper-trading-types";

async function json<T>(response: Response) {
  const body = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
  return body;
}

export async function fetchPortfolio(accountId?: string | null) {
  const query = accountId ? `?accountId=${encodeURIComponent(accountId)}` : "";
  return json<PortfolioResponse>(await fetch(`/api/portfolio${query}`, { cache: "no-store" }));
}

export async function createPortfolioAccount(input: { name: string; baseCurrency: string; description: string }) {
  return json(await fetch("/api/portfolio/accounts", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  }));
}

export async function savePortfolioHolding(input: Record<string, unknown>, holdingId?: string) {
  return json(await fetch(holdingId ? `/api/portfolio/holdings/${holdingId}` : "/api/portfolio/holdings", {
    method: holdingId ? "PATCH" : "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  }));
}

export async function createDividendEvent(input: Record<string, unknown>) {
  return json(await fetch("/api/portfolio/dividends", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  }));
}

export async function refreshPortfolio(accountId: string) {
  return json<PortfolioDashboard>(await fetch("/api/portfolio/refresh", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ accountId }),
  }));
}

export async function syncTossPortfolioAccount() {
  return json<{
    dashboard: PortfolioDashboard;
    result: {
      created: number;
      updated: number;
      deactivated: number;
      domesticCount: number;
      overseasCount: number;
      totalCount: number;
      syncedAt: string;
      readOnly: true;
    };
  }>(await fetch("/api/portfolio/account-sync", {
    method: "POST",
    headers: { "content-type": "application/json" },
  }));
}

export async function fetchPortfolioDailyAssistant(accountId?: string | null) {
  const query = accountId ? `?accountId=${encodeURIComponent(accountId)}` : "";
  return json<PortfolioDailyAssistantView | PortfolioDailyAssistantDisabled>(
    await fetch(`/api/portfolio/daily-assistant${query}`, { cache: "no-store" }),
  );
}

export async function fetchPortfolioPerformance(
  range: PortfolioPerformanceResponse["range"],
  accountId?: string | null,
) {
  const params = new URLSearchParams({ range });
  if (accountId) params.set("accountId", accountId);
  return json<PortfolioPerformanceResponse>(
    await fetch(`/api/portfolio/performance?${params}`, { cache: "no-store" }),
  );
}

export async function fetchPaperTrading() {
  return json<PaperTradingResponse>(await fetch("/api/portfolio/paper", { cache: "no-store" }));
}

export async function updatePaperTrading(action: "initialize" | "pause" | "resume" | "kill") {
  return json<PaperTradingResponse>(await fetch("/api/portfolio/paper", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action }),
  }));
}
