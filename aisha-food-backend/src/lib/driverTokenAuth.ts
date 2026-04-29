import { createHmac, timingSafeEqual } from "node:crypto";
import mongoose from "mongoose";
import { verifyDriverLinkToken } from "@/lib/driverLink";
import { ENV_DRIVER_LINK_SECRET } from "@/lib/env";
import { Driver } from "@/models/Driver";

type DriverLean = {
  _id: mongoose.Types.ObjectId;
  name: string;
  isActive: boolean;
  isBanned?: boolean;
  pausedAt?: Date | null;
  pausedReason?: string | null;
  phoneE164?: string | null;
  email?: string | null;
  vehicleType?: string | null;
  zoneLabel?: string;
  availability?: "offline" | "available" | "busy" | "paused";
  breakStartedAt?: Date | null;
  breakReason?: string | null;
  breakNote?: string | null;
  lastSeenAt?: Date | null;
  lastLocation?: {
    lat?: number | null;
    lng?: number | null;
    accuracy?: number | null;
    heading?: number | null;
    speed?: number | null;
    updatedAt?: Date | null;
  } | null;
};

type ApiError = Error & { status?: number; code?: string };

function tryParseLegacyToken(token: string, url: URL): { driverId: string; cityId: string } | null {
  const raw = String(token || "").trim();
  if (!raw || !raw.includes(".")) return null;
  const [payloadPart, signaturePart] = raw.split(".");
  if (!payloadPart || !signaturePart) return null;

  const expected = createHmac("sha256", ENV_DRIVER_LINK_SECRET).update(payloadPart).digest("base64url");
  const actualBuf = Buffer.from(signaturePart);
  const expectedBuf = Buffer.from(expected);
  if (actualBuf.length !== expectedBuf.length) return null;
  if (!timingSafeEqual(actualBuf, expectedBuf)) return null;

  let payload: { driverId?: string; exp?: number | null } | null = null;
  try {
    payload = JSON.parse(Buffer.from(payloadPart, "base64url").toString("utf8"));
  } catch {
    return null;
  }

  const driverId = String(payload?.driverId || "").trim();
  if (!mongoose.Types.ObjectId.isValid(driverId)) return null;

  const expValue = payload?.exp;
  if (expValue != null) {
    const expNum = Number(expValue);
    if (!Number.isFinite(expNum) || expNum < Math.floor(Date.now() / 1000)) return null;
  }

  const cityId = String(url.searchParams.get("cityId") || url.searchParams.get("city") || "").trim();
  if (!mongoose.Types.ObjectId.isValid(cityId)) return null;

  return { driverId, cityId };
}

export async function requireDriverFromToken(
  req: Request
): Promise<{ driver: DriverLean; tokenCityId: string }> {
  const url = new URL(req.url);
  const token =
    String(url.searchParams.get("token") || url.searchParams.get("key") || "").trim();
  if (!token) {
    const err = new Error("Driver token is required.") as ApiError;
    err.status = 401;
    err.code = "UNAUTHORIZED";
    throw err;
  }

  const payload = verifyDriverLinkToken(token);
  let driverId: string | null = null;
  let cityId: string | null = null;

  if (payload && mongoose.Types.ObjectId.isValid(payload.driverId) && mongoose.Types.ObjectId.isValid(payload.cityId)) {
    driverId = String(payload.driverId);
    cityId = String(payload.cityId);
  } else {
    const legacy = tryParseLegacyToken(token, url);
    if (legacy) {
      driverId = legacy.driverId;
      cityId = legacy.cityId;
    }
  }

  if (!driverId || !cityId) {
    const err = new Error("Invalid or expired driver token.") as ApiError;
    err.status = 401;
    err.code = "UNAUTHORIZED";
    throw err;
  }

  const driver = await Driver.findById(driverId)
    .select("_id name phoneE164 email vehicleType isActive isBanned pausedAt pausedReason breakStartedAt breakReason breakNote zoneLabel availability lastSeenAt lastLocation")
    .lean<DriverLean | null>();
  if (!driver || !driver.isActive || driver.isBanned) {
    const err = new Error("Driver not available.") as ApiError;
    err.status = 403;
    err.code = "DRIVER_NOT_AVAILABLE";
    throw err;
  }
  return { driver, tokenCityId: cityId };
}
