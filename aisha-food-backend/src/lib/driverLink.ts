import mongoose from "mongoose";
import { createHmac, timingSafeEqual } from "node:crypto";
import { ENV_DRIVER_LINK_SECRET } from "@/lib/env";

type DriverLinkPayload = {
  driverId: string;
  cityId: string;
  exp: number;
};

function base64url(input: string) {
  return Buffer.from(input, "utf8").toString("base64url");
}

function sign(payloadPart: string) {
  return createHmac("sha256", ENV_DRIVER_LINK_SECRET).update(payloadPart).digest("base64url");
}

export function createDriverLinkToken(driverId: string, cityId: string, days = 7) {
  if (!mongoose.Types.ObjectId.isValid(String(driverId || ""))) {
    throw new Error("Invalid driverId for link token.");
  }
  if (!mongoose.Types.ObjectId.isValid(String(cityId || ""))) {
    throw new Error("Invalid cityId for link token.");
  }
  const ttlDays = Math.max(1, Math.floor(Number(days || 7)));
  const payload: DriverLinkPayload = {
    driverId: String(driverId || "").trim(),
    cityId: String(cityId || "").trim(),
    exp: Math.floor(Date.now() / 1000) + ttlDays * 24 * 60 * 60,
  };
  const encodedPayload = base64url(JSON.stringify(payload));
  const signature = sign(encodedPayload);
  return `${encodedPayload}.${signature}`;
}

export function verifyDriverLinkToken(token: string): DriverLinkPayload | null {
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
  const payload = JSON.parse(payloadRaw) as DriverLinkPayload;
  if (!payload?.driverId || !payload?.cityId || !payload?.exp) return null;
  if (!mongoose.Types.ObjectId.isValid(String(payload.driverId))) return null;
  if (!mongoose.Types.ObjectId.isValid(String(payload.cityId))) return null;
  if (payload.exp < Math.floor(Date.now() / 1000)) return null;
  return payload;
}
