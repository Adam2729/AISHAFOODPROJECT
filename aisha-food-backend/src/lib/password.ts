import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const KEY_LEN = 64;

export function hashSecret(secret: string) {
  const normalized = String(secret || "").trim();
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(normalized, salt, KEY_LEN).toString("hex");
  return `scrypt$${salt}$${hash}`;
}

export function verifySecret(secret: string, storedHash: string) {
  const normalized = String(secret || "").trim();
  const [algo, salt, hashHex] = String(storedHash || "").split("$");
  if (algo !== "scrypt" || !salt || !hashHex) return false;
  const hash = Buffer.from(hashHex, "hex");
  const test = scryptSync(normalized, salt, hash.length);
  return timingSafeEqual(hash, test);
}
