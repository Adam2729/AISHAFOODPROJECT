import { createHash, createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { ENV_JWT_SECRET } from "@/lib/env";

const OTP_LENGTH = 6;
const OTP_MAX = 10 ** OTP_LENGTH;

function normalizeOtp(value: string) {
  return String(value || "").trim();
}

export function generateOtp() {
  return String(randomInt(0, OTP_MAX)).padStart(OTP_LENGTH, "0");
}

export function deriveOrderOtp(orderId: string, otpCreatedAt: Date | string | null | undefined) {
  const id = String(orderId || "").trim();
  const createdAt = new Date(otpCreatedAt || 0);
  const createdAtIso = Number.isNaN(createdAt.getTime())
    ? new Date(0).toISOString()
    : createdAt.toISOString();
  const digest = createHmac("sha256", ENV_JWT_SECRET)
    .update(`${id}|${createdAtIso}`)
    .digest();
  const numeric = digest.readUInt32BE(0) % OTP_MAX;
  return String(numeric).padStart(OTP_LENGTH, "0");
}

export function hashOtp(otp: string, saltKey = ENV_JWT_SECRET) {
  const normalized = normalizeOtp(otp);
  return createHash("sha256").update(`${normalized}:${saltKey}`).digest("hex");
}

export function verifyOtp(provided: string, storedHash: string, saltKey = ENV_JWT_SECRET) {
  const normalized = normalizeOtp(provided);
  if (!/^\d{6}$/.test(normalized)) return false;
  const expectedHash = String(storedHash || "").trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(expectedHash)) return false;
  const computedHash = hashOtp(normalized, saltKey).toLowerCase();
  const expected = Buffer.from(expectedHash, "utf8");
  const computed = Buffer.from(computedHash, "utf8");
  if (expected.length !== computed.length) return false;
  return timingSafeEqual(expected, computed);
}

export function maskOtp(otp: string) {
  const normalized = normalizeOtp(otp);
  if (!normalized) return "****";
  const suffix = normalized.slice(-2);
  return `****${suffix}`;
}

export function isOtpExpired(otpCreatedAt: Date | string | null | undefined, now = Date.now()) {
  const createdAtMs = new Date(otpCreatedAt || 0).getTime();
  if (!Number.isFinite(createdAtMs)) return true;
  return now - createdAtMs > 24 * 60 * 60 * 1000;
}
