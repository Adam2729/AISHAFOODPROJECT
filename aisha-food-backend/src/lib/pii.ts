import crypto from "crypto";
import { ENV_PII_HASH_SECRET } from "@/lib/env";

function digitsOnly(input: unknown) {
  return String(input || "").replace(/\D+/g, "");
}

export function normalizePhoneE164Like(input: string): string {
  const digits = digitsOnly(input);
  if (!digits) return "";

  // DR local numbers frequently come as 10 digits (809/829/849 + 7 digits).
  if (digits.length === 10) return `1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return digits;
  return digits;
}

export function hashPiiValue(value: string, namespace = "generic"): string {
  const normalized = String(value || "").trim();
  if (!normalized) return "";
  return crypto
    .createHash("sha256")
    .update(`${namespace}|${normalized}|${ENV_PII_HASH_SECRET}`)
    .digest("hex");
}

export function hashPhone(phone: string): string {
  const normalized = normalizePhoneE164Like(phone);
  if (!normalized) return "";
  return hashPiiValue(normalized, "phone");
}

export function hashSessionId(sessionId: string): string {
  return hashPiiValue(String(sessionId || "").trim(), "session");
}

export function hashIp(ip: string): string {
  return hashPiiValue(String(ip || "").trim(), "ip");
}

export function maskPhone(phone: string): string {
  const normalized = normalizePhoneE164Like(phone);
  if (!normalized) return "***";
  if (normalized.length <= 4) return "***";
  return `${"*".repeat(Math.max(0, normalized.length - 4))}${normalized.slice(-4)}`;
}

