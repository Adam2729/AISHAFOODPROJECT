import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { ENV_ADMIN_KEY, ENV_JWT_SECRET } from "@/lib/env";

const ADMIN_SESSION_COOKIE = "admin_session";

type AdminSessionPayload = {
  role: "admin";
  keyFingerprint: string;
  exp: number;
};

function base64url(input: string) {
  return Buffer.from(input, "utf8").toString("base64url");
}

function sign(payloadPart: string) {
  return createHmac("sha256", ENV_JWT_SECRET).update(payloadPart).digest("base64url");
}

function parseCookie(raw: string, name: string) {
  const parts = String(raw || "")
    .split(";")
    .map((value) => value.trim());
  for (const part of parts) {
    if (!part.startsWith(`${name}=`)) continue;
    return decodeURIComponent(part.slice(name.length + 1));
  }
  return "";
}

function getAdminKeyFingerprint() {
  return createHash("sha256").update(ENV_ADMIN_KEY).digest("base64url").slice(0, 16);
}

export function createAdminSessionToken(hours = 12) {
  const ttlSec = Math.max(60, Math.floor(Number(hours || 12) * 60 * 60));
  const payload: AdminSessionPayload = {
    role: "admin",
    keyFingerprint: getAdminKeyFingerprint(),
    exp: Math.floor(Date.now() / 1000) + ttlSec,
  };
  const payloadPart = base64url(JSON.stringify(payload));
  const signaturePart = sign(payloadPart);
  return `${payloadPart}.${signaturePart}`;
}

export function verifyAdminSessionToken(token: string) {
  const raw = String(token || "").trim();
  if (!raw || !raw.includes(".")) return null;
  const [payloadPart, signaturePart] = raw.split(".");
  if (!payloadPart || !signaturePart) return null;

  const expectedSignature = sign(payloadPart);
  const actualBuffer = Buffer.from(signaturePart);
  const expectedBuffer = Buffer.from(expectedSignature);
  if (actualBuffer.length !== expectedBuffer.length) return null;
  if (!timingSafeEqual(actualBuffer, expectedBuffer)) return null;

  try {
    const payloadRaw = Buffer.from(payloadPart, "base64url").toString("utf8");
    const payload = JSON.parse(payloadRaw) as AdminSessionPayload;
    if (payload.role !== "admin" || !payload.exp || !payload.keyFingerprint) return null;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    if (payload.keyFingerprint !== getAdminKeyFingerprint()) return null;
    return payload;
  } catch {
    return null;
  }
}

export function getAdminSessionFromCookieHeader(rawCookie: string) {
  const token = parseCookie(rawCookie, ADMIN_SESSION_COOKIE);
  if (!token) return null;
  return verifyAdminSessionToken(token);
}

export function getAdminSessionFromRequest(req: Request) {
  return getAdminSessionFromCookieHeader(String(req.headers.get("cookie") || ""));
}

export function setAdminSessionCookie(res: NextResponse, token: string, maxAgeSec: number) {
  res.cookies.set(ADMIN_SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: Math.max(60, Math.floor(Number(maxAgeSec || 12 * 60 * 60))),
  });
  return res;
}

export function clearAdminSessionCookie(res: NextResponse) {
  res.cookies.set(ADMIN_SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
  return res;
}

export function adminSessionCookieName() {
  return ADMIN_SESSION_COOKIE;
}
