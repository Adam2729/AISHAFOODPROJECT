import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const PASSWORD_HASH_PREFIX = "scrypt";
const SCRYPT_KEY_LENGTH = 64;

function normalizePassword(password: unknown) {
  return String(password || "");
}

export function hashDriverPassword(password: unknown) {
  const normalizedPassword = normalizePassword(password);
  const salt = randomBytes(16).toString("base64url");
  const key = scryptSync(normalizedPassword, salt, SCRYPT_KEY_LENGTH).toString("base64url");
  return `${PASSWORD_HASH_PREFIX}$${salt}$${key}`;
}

export function verifyDriverPassword(password: unknown, passwordHash: unknown) {
  const normalizedHash = String(passwordHash || "").trim();
  const [prefix, salt, expectedKey] = normalizedHash.split("$");
  if (prefix !== PASSWORD_HASH_PREFIX || !salt || !expectedKey) return false;

  const actualKey = scryptSync(normalizePassword(password), salt, SCRYPT_KEY_LENGTH);
  const expectedKeyBuffer = Buffer.from(expectedKey, "base64url");
  if (actualKey.length !== expectedKeyBuffer.length) return false;

  return timingSafeEqual(actualKey, expectedKeyBuffer);
}

export function normalizeDriverEmail(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

export function normalizeDriverCredential(value: unknown) {
  return String(value || "").trim();
}
