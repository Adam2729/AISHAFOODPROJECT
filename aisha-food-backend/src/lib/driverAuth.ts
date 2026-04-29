import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { ENV_DRIVER_JWT_SECRET } from "@/lib/env";
import { DRIVER_SESSION_COOKIE, driverSessionCookieName } from "@/lib/driverSession";

type DriverJwtPayload = {
  driverId: string;
  cityId: string;
  iat: number;
  exp: number;
};

type ApiError = Error & { status?: number; code?: string };

function getDriverBearerToken(req: Request) {
  const authorization = String(req.headers.get("authorization") || "").trim();
  const [scheme, token] = authorization.split(/\s+/);

  if (scheme?.toLowerCase() !== "bearer") return null;
  return String(token || "").trim() || null;
}

function base64url(input: string) {
  return Buffer.from(input, "utf8").toString("base64url");
}

function sign(input: string) {
  return createHmac("sha256", ENV_DRIVER_JWT_SECRET).update(input).digest("base64url");
}

function parseCookie(raw: string, name: string) {
  const parts = raw.split(";").map((x) => x.trim());
  for (const part of parts) {
    if (!part.startsWith(`${name}=`)) continue;
    return decodeURIComponent(part.slice(name.length + 1));
  }
  return "";
}

export function hashDriverLinkToken(token: string) {
  return createHash("sha256").update(String(token || "").trim()).digest("base64url");
}

export function createDriverLinkToken() {
  const token = randomBytes(32).toString("base64url");
  const tokenHash = hashDriverLinkToken(token);
  return { token, tokenHash };
}

export function signDriverJwt(payload: { driverId: string; cityId: string; ttlSec?: number }) {
  const nowSec = Math.floor(Date.now() / 1000);
  const ttlSec = Math.max(60, Math.floor(Number(payload.ttlSec || 24 * 60 * 60)));
  const jwtPayload: DriverJwtPayload = {
    driverId: String(payload.driverId || "").trim(),
    cityId: String(payload.cityId || "").trim(),
    iat: nowSec,
    exp: nowSec + ttlSec,
  };
  const encodedPayload = base64url(JSON.stringify(jwtPayload));
  const signature = sign(encodedPayload);
  return `${encodedPayload}.${signature}`;
}

export function verifyDriverJwt(token: string): DriverJwtPayload | null {
  try {
    const raw = String(token || "").trim();
    if (!raw || !raw.includes(".")) return null;
    const [payloadPart, signaturePart] = raw.split(".");
    if (!payloadPart || !signaturePart) return null;

    const expected = sign(payloadPart);
    const actualBuf = Buffer.from(signaturePart);
    const expectedBuf = Buffer.from(expected);
    if (actualBuf.length !== expectedBuf.length) return null;
    if (!timingSafeEqual(actualBuf, expectedBuf)) return null;

    const payloadRaw = Buffer.from(payloadPart, "base64url").toString("utf8");
    const payload = JSON.parse(payloadRaw) as DriverJwtPayload;
    if (!payload.driverId || !payload.cityId || !payload.iat || !payload.exp) return null;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

export function getDriverSessionFromRequest(req: Request) {
  const bearerToken = getDriverBearerToken(req);
  if (bearerToken) return verifyDriverJwt(bearerToken);

  const cookie = req.headers.get("cookie") || "";
  const token = parseCookie(cookie, DRIVER_SESSION_COOKIE);
  return verifyDriverJwt(token);
}

export function requireDriverSession(req: Request) {
  const session = getDriverSessionFromRequest(req);
  if (!session) {
    const err = new Error("Driver auth required.") as ApiError;
    err.status = 401;
    err.code = "UNAUTHORIZED";
    throw err;
  }
  return session;
}

export function setDriverSessionCookie(res: NextResponse, token: string, maxAgeSec: number) {
  res.cookies.set(DRIVER_SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: Math.max(60, Math.floor(Number(maxAgeSec || 24 * 60 * 60))),
  });
  return res;
}

export { driverSessionCookieName };
