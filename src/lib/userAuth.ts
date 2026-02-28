import { createHmac, timingSafeEqual } from "node:crypto";
import { ENV_JWT_SECRET } from "@/lib/env";

const COOKIE_NAME = "user_session";

type SessionPayload = {
  phoneHash: string;
  exp: number;
};

function base64url(input: string) {
  return Buffer.from(input, "utf8").toString("base64url");
}

function sign(payloadPart: string) {
  return createHmac("sha256", ENV_JWT_SECRET).update(payloadPart).digest("base64url");
}

function parseCookie(raw: string, name: string) {
  const parts = raw.split(";").map((x) => x.trim());
  for (const part of parts) {
    if (!part.startsWith(`${name}=`)) continue;
    return decodeURIComponent(part.slice(name.length + 1));
  }
  return "";
}

export function createUserToken(phoneHash: string, days = 30) {
  const payload: SessionPayload = {
    phoneHash: String(phoneHash || "").trim(),
    exp: Math.floor(Date.now() / 1000) + days * 24 * 60 * 60,
  };
  const payloadPart = base64url(JSON.stringify(payload));
  const sigPart = sign(payloadPart);
  return `${payloadPart}.${sigPart}`;
}

export function verifyUserToken(token: string): SessionPayload | null {
  if (!token || !token.includes(".")) return null;
  const [payloadPart, sigPart] = token.split(".");
  if (!payloadPart || !sigPart) return null;
  const expected = sign(payloadPart);

  const sigBuffer = Buffer.from(sigPart);
  const expectedBuffer = Buffer.from(expected);
  if (sigBuffer.length !== expectedBuffer.length) return null;
  if (!timingSafeEqual(sigBuffer, expectedBuffer)) return null;

  try {
    const raw = Buffer.from(payloadPart, "base64url").toString("utf8");
    const payload = JSON.parse(raw) as SessionPayload;
    if (!payload.phoneHash || !payload.exp) return null;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

function extractHeaderToken(req: Request) {
  const xHeader = String(req.headers.get("x-user-session") || "").trim();
  if (xHeader) return xHeader;
  const authHeader = String(req.headers.get("authorization") || "").trim();
  if (authHeader.toLowerCase().startsWith("bearer ")) {
    return authHeader.slice(7).trim();
  }
  return "";
}

export function getUserSessionFromRequest(req: Request) {
  const headerToken = extractHeaderToken(req);
  if (headerToken) return verifyUserToken(headerToken);

  const cookieRaw = String(req.headers.get("cookie") || "");
  const cookieToken = parseCookie(cookieRaw, COOKIE_NAME);
  if (!cookieToken) return null;
  return verifyUserToken(cookieToken);
}

export function requireUserSession(req: Request) {
  const session = getUserSessionFromRequest(req);
  if (!session) {
    const err = new Error("User auth required.") as Error & { status?: number; code?: string };
    err.status = 401;
    err.code = "UNAUTHORIZED";
    throw err;
  }
  return session;
}

export function userSessionCookieName() {
  return COOKIE_NAME;
}
