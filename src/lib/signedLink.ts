import { createHmac, timingSafeEqual } from "node:crypto";
import { ENV_STATEMENT_SIGNING_SECRET } from "@/lib/env";

type SignedPayload = Record<string, unknown> & { exp?: number };

function base64url(input: string) {
  return Buffer.from(input, "utf8").toString("base64url");
}

function sign(payloadPart: string) {
  return createHmac("sha256", ENV_STATEMENT_SIGNING_SECRET).update(payloadPart).digest("base64url");
}

export function createSignedToken(payload: SignedPayload, ttlSeconds: number) {
  const ttl = Math.max(1, Math.floor(Number(ttlSeconds || 0)));
  const body = {
    ...payload,
    exp: Math.floor(Date.now() / 1000) + ttl,
  };
  const encodedPayload = base64url(JSON.stringify(body));
  const signature = sign(encodedPayload);
  return `${encodedPayload}.${signature}`;
}

export function verifySignedToken<T extends SignedPayload>(token: string): T | null {
  const raw = String(token || "").trim();
  if (!raw || !raw.includes(".")) return null;
  const [payloadPart, sigPart] = raw.split(".");
  if (!payloadPart || !sigPart) return null;
  const expected = sign(payloadPart);
  const actualBuf = Buffer.from(sigPart);
  const expectedBuf = Buffer.from(expected);
  if (actualBuf.length !== expectedBuf.length) return null;
  if (!timingSafeEqual(actualBuf, expectedBuf)) return null;

  const payloadRaw = Buffer.from(payloadPart, "base64url").toString("utf8");
  const payload = JSON.parse(payloadRaw) as T;
  const exp = Number(payload?.exp || 0);
  if (!Number.isFinite(exp) || exp <= Math.floor(Date.now() / 1000)) return null;
  return payload;
}
