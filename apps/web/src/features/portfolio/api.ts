import type { PortfolioDashboard, PortfolioResponse } from "@/lib/portfolio/portfolio-types";

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
