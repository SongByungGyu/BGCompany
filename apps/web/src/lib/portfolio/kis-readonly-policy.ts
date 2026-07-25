export const KIS_READ_ONLY_ENDPOINTS = {
  "/uapi/domestic-stock/v1/quotations/inquire-price": "FHKST01010100",
  "/uapi/overseas-price/v1/quotations/price": "HHDFS00000300",
  "/uapi/overseas-price/v1/quotations/dailyprice": "HHDFS76240000",
  "/uapi/overseas-price/v1/quotations/inquire-daily-chartprice": "FHKST03030100",
} as const;

export function isKisReadOnlyRequestAllowed(method: string, path: string, trId: string) {
  if (method.toUpperCase() !== "GET") return false;
  return KIS_READ_ONLY_ENDPOINTS[path as keyof typeof KIS_READ_ONLY_ENDPOINTS] === trId;
}

export const KIS_PROHIBITED_CAPABILITIES = [
  "order",
  "buy",
  "sell",
  "transfer",
  "cancel",
  "amend",
  "orderable_cash",
  "trade_history",
] as const;
