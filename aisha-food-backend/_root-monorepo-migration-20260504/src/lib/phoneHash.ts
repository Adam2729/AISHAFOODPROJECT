import { hashPhone as piiHashPhone, normalizePhoneE164Like } from "@/lib/pii";

export function normalizePhone(phone: string): string {
  return normalizePhoneE164Like(phone);
}

export function hashPhone(normalizedOrRaw: string): string {
  return piiHashPhone(normalizedOrRaw);
}

export function phoneToHash(phoneRaw: string): string {
  return piiHashPhone(phoneRaw);
}
