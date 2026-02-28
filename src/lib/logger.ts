import { maskPhone as maskPhoneSafe } from "@/lib/pii";

type LogExtra = Record<string, unknown>;

type LogMeta = {
  route: string;
  status: number;
  durationMs: number;
  requestId?: string;
  extra?: LogExtra;
};

export function maskPhone(phone: string) {
  return maskPhoneSafe(phone);
}

export function maskIp(ip: string) {
  const raw = String(ip || "").trim();
  if (!raw) return "***";
  if (raw.includes(":")) {
    const parts = raw.split(":");
    return `${parts.slice(0, 2).join(":")}:***`;
  }
  const parts = raw.split(".");
  if (parts.length === 4) return `${parts[0]}.${parts[1]}.${parts[2]}.*`;
  return "***";
}

export function logRequest(req: Request, meta: LogMeta) {
  const headerRequestId = String(req.headers.get("x-request-id") || "").trim();
  const scrubbedExtra = meta.extra ? scrubSensitive(meta.extra) : undefined;
  const payload = {
    type: "request_log",
    method: req.method,
    route: meta.route,
    status: meta.status,
    durationMs: meta.durationMs,
    requestId: String(meta.requestId || "").trim() || headerRequestId || null,
    ...(scrubbedExtra ? { extra: scrubbedExtra } : {}),
    timestamp: new Date().toISOString(),
  };
  console.log(JSON.stringify(payload));
}

function shouldRedactKey(key: string) {
  const normalized = String(key || "").trim().toLowerCase();
  return normalized === "deliveryotp" || normalized.endsWith(".deliveryotp") || normalized === "otp";
}

function scrubSensitive(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => scrubSensitive(item));
  }
  if (!value || typeof value !== "object") return value;

  const input = value as Record<string, unknown>;
  const output: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(input)) {
    output[key] = shouldRedactKey(key) ? "[REDACTED]" : scrubSensitive(nested);
  }
  return output;
}
