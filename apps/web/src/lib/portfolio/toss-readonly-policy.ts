export const TOSS_OAUTH_TOKEN_PATH = "/oauth2/token";

export const TOSS_READ_ONLY_ENDPOINTS = [
  "/api/v1/accounts",
  "/api/v1/holdings",
] as const;

export function isTossRequestAllowed(method: string, path: string) {
  const normalizedMethod = method.toUpperCase();
  if (path === TOSS_OAUTH_TOKEN_PATH) return normalizedMethod === "POST";
  return normalizedMethod === "GET"
    && TOSS_READ_ONLY_ENDPOINTS.includes(path as (typeof TOSS_READ_ONLY_ENDPOINTS)[number]);
}

export const TOSS_PROHIBITED_CAPABILITIES = [
  "order",
  "buy",
  "sell",
  "transfer",
  "cancel",
  "amend",
  "withdraw",
] as const;
