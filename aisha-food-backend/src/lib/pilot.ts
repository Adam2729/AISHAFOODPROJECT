import { getBoolSetting, getStringSetting } from "@/lib/appSettings";

type PilotModeSnapshot = {
  pilotMode: boolean;
  allowlistEnabled: boolean;
  allowlistSize: number;
};

type PilotAllowedResult = {
  allowed: boolean;
  reason?: string;
  mode: PilotModeSnapshot;
};

type PilotError = Error & { status?: number; code?: string };

export function normalizePhone(input: string): { digits: string; last10: string } {
  const digits = String(input || "").replace(/\D+/g, "");
  const last10 = digits.slice(-10);
  return { digits, last10 };
}

export function parseAllowlist(raw: string): Set<string> {
  const tokens = String(raw || "")
    .split(/[\s,]+/)
    .map((token) => normalizePhone(token).digits)
    .filter(Boolean);
  return new Set(tokens);
}

export async function isPilotAllowed(phone: string): Promise<PilotAllowedResult> {
  const [pilotMode, allowlistEnabled, allowlistRaw] = await Promise.all([
    getBoolSetting("pilot_mode", false),
    getBoolSetting("pilot_allowlist_enabled", true),
    getStringSetting("pilot_allowlist_phones", ""),
  ]);

  const allowlist = parseAllowlist(allowlistRaw);
  const allowlistLast10 = new Set(
    Array.from(allowlist)
      .map((entry) => entry.slice(-10))
      .filter(Boolean)
  );

  const mode: PilotModeSnapshot = {
    pilotMode,
    allowlistEnabled,
    allowlistSize: allowlist.size,
  };

  if (!pilotMode) return { allowed: true, reason: "pilot_mode_off", mode };
  if (!allowlistEnabled) return { allowed: true, reason: "allowlist_disabled", mode };

  const normalized = normalizePhone(phone);
  if (!normalized.digits) return { allowed: false, reason: "missing_phone", mode };

  const allowed =
    allowlist.has(normalized.digits) ||
    (Boolean(normalized.last10) && allowlist.has(normalized.last10)) ||
    (Boolean(normalized.last10) && allowlistLast10.has(normalized.last10));

  if (allowed) return { allowed: true, reason: "allowlisted", mode };
  return { allowed: false, reason: "not_allowlisted", mode };
}

export async function assertPilotAllowed(phone: string): Promise<void> {
  const check = await isPilotAllowed(phone);
  if (check.allowed) return;

  const err = new Error(
    "Acceso limitado (modo piloto). Este servicio est\u00e1 disponible solo para clientes autorizados."
  ) as PilotError;
  err.status = 403;
  err.code = "PILOT_RESTRICTED";
  throw err;
}
