import { createHmac, timingSafeEqual } from "node:crypto";
import { ENV_JWT_SECRET } from "@/lib/env";

const COOKIE_NAME = "merchant_session";

function base64url(input: string) {
  return Buffer.from(input, "utf8").toString("base64url");
}

function sign(input: string) {
  const secret = ENV_JWT_SECRET;
  return createHmac("sha256", secret).update(input).digest("base64url");
}

type SessionPayload = {
  businessId: string;
  exp: number;
};

export function createMerchantToken(businessId: string, days = 7) {
  const payload: SessionPayload = {
    businessId,
    exp: Math.floor(Date.now() / 1000) + days * 24 * 60 * 60,
  };
  const encodedPayload = base64url(JSON.stringify(payload));
  const signature = sign(encodedPayload);
  return `${encodedPayload}.${signature}`;
}

function parseCookie(raw: string, name: string) {
  const parts = raw.split(";").map((x) => x.trim());
  for (const p of parts) {
    if (!p.startsWith(`${name}=`)) continue;
    return decodeURIComponent(p.slice(name.length + 1));
  }
  return "";
}

export function verifyMerchantToken(token: string): SessionPayload | null {
  if (!token || !token.includes(".")) return null;
  const [payloadPart, sigPart] = token.split(".");
  const expected = sign(payloadPart);
  if (!sigPart || !expected) return null;
  const actualBuf = Buffer.from(sigPart);
  const expectedBuf = Buffer.from(expected);
  if (actualBuf.length !== expectedBuf.length) return null;
  if (!timingSafeEqual(actualBuf, expectedBuf)) return null;

  const payloadRaw = Buffer.from(payloadPart, "base64url").toString("utf8");
  const payload = JSON.parse(payloadRaw) as SessionPayload;
  if (!payload.businessId || !payload.exp) return null;
  if (payload.exp < Math.floor(Date.now() / 1000)) return null;
  return payload;
}

export function getMerchantSessionFromRequest(req: Request) {
  const cookie = req.headers.get("cookie") || "";
  const token = parseCookie(cookie, COOKIE_NAME);
  return verifyMerchantToken(token);
}

export function requireMerchantSession(req: Request) {
  const session = getMerchantSessionFromRequest(req);
  if (!session) {
    const err = new Error("Merchant auth required.") as Error & { status?: number; code?: string };
    err.status = 401;
    err.code = "UNAUTHORIZED";
    throw err;
  }
  return session;
}

export function merchantCookieName() {
  return COOKIE_NAME;
}
