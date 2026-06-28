import { NextResponse } from "next/server";

export const ADMIN_SESSION_COOKIE = "bg_admin_session";
export const ADMIN_SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

type AdminSessionPayload = {
  exp: number;
  iat: number;
  role: "admin";
};

function getSessionSecret() {
  return process.env.AUTH_SESSION_SECRET?.trim() ?? "";
}

function base64UrlEncode(value: string) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function base64UrlDecode(value: string) {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

async function hmacSha256(value: string) {
  const secret = getSessionSecret();
  if (!secret) throw new Error("AUTH_SESSION_SECRET is not configured");
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  let binary = "";
  new Uint8Array(signature).forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function getCookieFromHeader(request: Request, name: string) {
  const cookieHeader = request.headers.get("cookie");
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const [rawKey, ...rawValue] = part.trim().split("=");
    if (rawKey === name) return rawValue.join("=") || null;
  }
  return null;
}

export function getAdminPasswordConfigured() {
  return Boolean(process.env.ADMIN_PASSWORD?.trim());
}

export function verifyAdminPassword(password: string) {
  const configuredPassword = process.env.ADMIN_PASSWORD?.trim() ?? "";
  if (!configuredPassword) return false;
  return password === configuredPassword;
}

export async function createAdminSessionToken(now = Date.now()) {
  const payload: AdminSessionPayload = {
    exp: now + ADMIN_SESSION_MAX_AGE_SECONDS * 1000,
    iat: now,
    role: "admin",
  };
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signature = await hmacSha256(encodedPayload);
  return encodedPayload + "." + signature;
}

export async function verifyAdminSessionToken(token?: string | null, now = Date.now()) {
  if (!token) return false;
  const [encodedPayload, signature, extra] = token.split(".");
  if (!encodedPayload || !signature || extra) return false;
  const expectedSignature = await hmacSha256(encodedPayload);
  if (signature !== expectedSignature) return false;
  try {
    const payload = JSON.parse(base64UrlDecode(encodedPayload)) as Partial<AdminSessionPayload>;
    return payload.role === "admin" && typeof payload.exp === "number" && payload.exp > now;
  } catch {
    return false;
  }
}

export async function getAdminSession(request: Request) {
  try {
    return await verifyAdminSessionToken(getCookieFromHeader(request, ADMIN_SESSION_COOKIE));
  } catch {
    return false;
  }
}

export function unauthorizedJson() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

export async function requireAdminApiSession(
  request: Request,
): Promise<{ ok: true } | { ok: false; response: NextResponse }> {
  if (await getAdminSession(request)) return { ok: true };
  return { ok: false, response: unauthorizedJson() };
}
