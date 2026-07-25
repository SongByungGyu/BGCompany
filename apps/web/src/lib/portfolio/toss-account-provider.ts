import "server-only";
import { createHash } from "node:crypto";
import { portfolioConfig } from "./portfolio-config";
import { normalizeTossHoldings } from "./toss-account-normalizer";
import { isTossRequestAllowed } from "./toss-readonly-policy";

const TOSS_HOST = "openapi.tossinvest.com";
const TOSS_BASE_URL = `https://${TOSS_HOST}`;
const REQUEST_TIMEOUT_MS = 10_000;

type TossAccount = {
  accountNo: string;
  accountSeq: number;
  accountType: string;
};

type TossAccountConfig = {
  clientId: string;
  clientSecret: string;
  configuredAccountSeq: number | null;
  accountLabel: string;
};

type CachedToken = {
  accessToken: string;
  expiresAt: number;
};

let cachedToken: CachedToken | null = null;

function object(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function resultOf(value: unknown) {
  const row = object(value);
  return "result" in row ? row.result : value;
}

function safeAccount(value: unknown): TossAccount | null {
  const row = object(value);
  const accountNo = typeof row.accountNo === "string" ? row.accountNo.trim() : "";
  const accountSeq = typeof row.accountSeq === "number"
    ? row.accountSeq
    : Number.parseInt(String(row.accountSeq ?? ""), 10);
  const accountType = typeof row.accountType === "string" ? row.accountType.trim() : "";
  return accountNo && Number.isInteger(accountSeq) && accountSeq > 0
    ? { accountNo, accountSeq, accountType }
    : null;
}

export function selectTossAccount(accounts: TossAccount[], configuredAccountSeq: number | null) {
  const brokerage = accounts.filter((account) => account.accountType === "BROKERAGE");
  if (!brokerage.length) throw new Error("TOSS_ACCOUNTS_EMPTY");
  if (configuredAccountSeq !== null) {
    const selected = brokerage.find((account) => account.accountSeq === configuredAccountSeq);
    if (!selected) throw new Error("TOSS_ACCOUNT_NOT_FOUND");
    return selected;
  }
  if (brokerage.length !== 1) throw new Error("TOSS_ACCOUNT_SELECTION_REQUIRED");
  return brokerage[0];
}

function getTossAccountConfig(): TossAccountConfig {
  const config = portfolioConfig();
  if (!config.accountSyncEnabled || config.accountSyncProvider !== "toss") {
    throw new Error("TOSS_ACCOUNT_SYNC_DISABLED");
  }
  const clientId = process.env.TOSSINVEST_CLIENT_ID?.trim() ?? "";
  const clientSecret = process.env.TOSSINVEST_CLIENT_SECRET?.trim() ?? "";
  if (!clientId || !clientSecret) throw new Error("TOSS_CREDENTIALS_MISSING");
  const rawAccountSeq = process.env.TOSSINVEST_ACCOUNT_SEQ?.trim() ?? "";
  const configuredAccountSeq = rawAccountSeq ? Number.parseInt(rawAccountSeq, 10) : null;
  if (rawAccountSeq && (!Number.isInteger(configuredAccountSeq) || configuredAccountSeq! <= 0)) {
    throw new Error("TOSS_ACCOUNT_SEQ_INVALID");
  }
  return {
    clientId,
    clientSecret,
    configuredAccountSeq,
    accountLabel: process.env.TOSSINVEST_ACCOUNT_LABEL?.trim().slice(0, 100) || "토스증권 실계좌",
  };
}

export function getTossAccountSyncPublicConfig() {
  const config = portfolioConfig();
  if (!config.accountSyncEnabled || config.accountSyncProvider !== "toss") {
    return { enabled: false, configured: false, maskedAccount: null };
  }
  const configured = Boolean(
    process.env.TOSSINVEST_CLIENT_ID?.trim()
    && process.env.TOSSINVEST_CLIENT_SECRET?.trim(),
  );
  const accountSeq = process.env.TOSSINVEST_ACCOUNT_SEQ?.trim();
  return {
    enabled: true,
    configured,
    maskedAccount: configured ? (accountSeq ? `계좌 식별자 ${accountSeq}` : "종합매매 계좌 자동 선택") : null,
  };
}

function tossUrl(path: string) {
  const url = new URL(path, TOSS_BASE_URL);
  if (url.protocol !== "https:" || url.hostname !== TOSS_HOST) throw new Error("TOSS_HOST_NOT_ALLOWED");
  return url;
}

async function responseJson(response: Response) {
  const body = await response.json().catch(() => null) as unknown;
  if (response.ok) return body;
  if (response.status === 401) {
    cachedToken = null;
    throw new Error("TOSS_AUTH_FAILED");
  }
  if (response.status === 403) throw new Error("TOSS_IP_NOT_ALLOWED");
  if (response.status === 429) throw new Error("TOSS_RATE_LIMITED");
  throw new Error("TOSS_RESPONSE_ERROR");
}

async function issueAccessToken(config: TossAccountConfig) {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.accessToken;
  if (!isTossRequestAllowed("POST", "/oauth2/token")) throw new Error("TOSS_QUERY_NOT_ALLOWLISTED");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(tossUrl("/oauth2/token"), {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: config.clientId,
        client_secret: config.clientSecret,
      }),
      cache: "no-store",
      signal: controller.signal,
    });
    const body = object(await responseJson(response));
    const accessToken = typeof body.access_token === "string" ? body.access_token : "";
    const expiresIn = Number(body.expires_in);
    if (!accessToken) throw new Error("TOSS_AUTH_FAILED");
    cachedToken = {
      accessToken,
      expiresAt: Date.now() + (Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : 3600) * 1000,
    };
    return accessToken;
  } finally {
    clearTimeout(timeout);
  }
}

async function tossReadOnlyGet(path: "/api/v1/accounts" | "/api/v1/holdings", accountSeq?: number) {
  if (!isTossRequestAllowed("GET", path)) throw new Error("TOSS_QUERY_NOT_ALLOWLISTED");
  const config = getTossAccountConfig();
  const accessToken = await issueAccessToken(config);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(tossUrl(path), {
      method: "GET",
      headers: {
        authorization: `Bearer ${accessToken}`,
        ...(accountSeq ? { "X-Tossinvest-Account": String(accountSeq) } : {}),
      },
      cache: "no-store",
      signal: controller.signal,
    });
    return responseJson(response);
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchTossAccountHoldings() {
  const config = getTossAccountConfig();
  const accountsPayload = resultOf(await tossReadOnlyGet("/api/v1/accounts"));
  const accounts = (Array.isArray(accountsPayload) ? accountsPayload : [])
    .map(safeAccount)
    .filter((account): account is TossAccount => account !== null);
  const selected = selectTossAccount(accounts, config.configuredAccountSeq);
  const holdingsPayload = resultOf(await tossReadOnlyGet("/api/v1/holdings", selected.accountSeq));
  const holdings = normalizeTossHoldings(holdingsPayload);
  const digest = createHash("sha256")
    .update(`${selected.accountSeq}:${selected.accountNo}`)
    .digest("hex")
    .slice(0, 20);
  const digits = selected.accountNo.replace(/\D/g, "");
  return {
    config: {
      accountLabel: config.accountLabel,
      externalAccountRef: `toss:${digest}`,
      maskedAccount: digits ? `••••${digits.slice(-4)}` : `계좌 식별자 ${selected.accountSeq}`,
      markets: ["KR", "US"] as const,
    },
    holdings,
    domesticCount: holdings.filter((holding) => holding.market === "KR").length,
    overseasCount: holdings.filter((holding) => holding.market === "US").length,
  };
}

export const TOSS_ACCOUNT_READ_ONLY_POLICY = {
  methods: { oauth: ["POST"], business: ["GET"] },
  endpoints: ["/oauth2/token", "/api/v1/accounts", "/api/v1/holdings"],
  prohibitedPathFragments: ["order", "buy", "sell", "transfer", "cancel", "amend"],
  storesFullAccountNumber: false,
} as const;
