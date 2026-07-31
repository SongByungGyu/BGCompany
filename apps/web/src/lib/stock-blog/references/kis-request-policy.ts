export const KIS_RETRYABLE_HTTP_STATUSES = new Set([429, 500, 502, 503, 504]);
export const KIS_RETRYABLE_RESPONSE_CODES = new Set(["EGW00201"]);
export const KIS_DEFAULT_MIN_REQUEST_INTERVAL_MS = 800;
export const KIS_MAX_RETRIES = 2;
export const KIS_PROHIBITED_CAPABILITIES = [
  "order",
  "balance",
  "account",
  "position",
  "buy",
  "sell",
] as const;

export function getKisMinRequestIntervalMs(value?: string) {
  const parsed = Number.parseInt(value ?? String(KIS_DEFAULT_MIN_REQUEST_INTERVAL_MS), 10);
  return Number.isFinite(parsed)
    ? Math.max(0, Math.min(parsed, 5000))
    : KIS_DEFAULT_MIN_REQUEST_INTERVAL_MS;
}
