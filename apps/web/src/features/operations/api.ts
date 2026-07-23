import type { OperationsOverview } from "@/lib/operations/operations-overview-types";

export async function fetchOperationsOverview(): Promise<OperationsOverview> {
  const response = await fetch("/api/operations-overview", { cache: "no-store" });
  if (!response.ok) throw new Error(`운영 현황 조회 실패 (${response.status})`);
  return response.json() as Promise<OperationsOverview>;
}
