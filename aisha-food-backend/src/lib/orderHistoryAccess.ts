import { createHmac, timingSafeEqual } from "node:crypto";
import { ENV_JWT_SECRET } from "@/lib/env";

type OrderHistoryAccessPayload = {
  phoneHash: string;
  sessionIdHash: string;
  exp: number;
};

function base64url(input: string) {
  return Buffer.from(input, "utf8").toString("base64url");
}

function sign(payloadPart: string) {
  return createHmac("sha256", ENV_JWT_SECRET).update(payloadPart).digest("base64url");
}

export function createOrderHistoryAccessToken(
  phoneHash: string,
  sessionIdHash: string,
  ttlMinutes = 10
) {
  const safeTtlMinutes = Math.max(1, Math.floor(Number(ttlMinutes || 10)));
  const payload: OrderHistoryAccessPayload = {
    phoneHash: String(phoneHash || "").trim(),
    sessionIdHash: String(sessionIdHash || "").trim(),
    exp: Math.floor(Date.now() / 1000) + safeTtlMinutes * 60,
  };
  const payloadPart = base64url(JSON.stringify(payload));
  const signaturePart = sign(payloadPart);
  return `${payloadPart}.${signaturePart}`;
}

export function verifyOrderHistoryAccessToken(token: string) {
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
    const payload = JSON.parse(payloadRaw) as OrderHistoryAccessPayload;
    if (!payload.phoneHash || !payload.sessionIdHash || !payload.exp) return null;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}
