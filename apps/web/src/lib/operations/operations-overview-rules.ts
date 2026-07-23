import type { OperationsHealth, OperationsService } from "./operations-overview-types";

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

export function getKstDayWindow(now: Date) {
  const shifted = new Date(now.getTime() + KST_OFFSET_MS);
  const year = shifted.getUTCFullYear();
  const month = shifted.getUTCMonth();
  const day = shifted.getUTCDate();
  const start = new Date(Date.UTC(year, month, day) - KST_OFFSET_MS);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  const date = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return { start, end, date };
}

export function getServiceOverallStatus(services: OperationsService[]): OperationsHealth {
  if (services.some((entry) => entry.status === "critical")) return "critical";
  if (services.some((entry) => entry.status === "warning")) return "warning";
  if (services.some((entry) => entry.status === "healthy")) return "healthy";
  return "idle";
}
