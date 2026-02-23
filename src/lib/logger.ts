type LogExtra = Record<string, unknown>;

type LogMeta = {
  route: string;
  status: number;
  durationMs: number;
  extra?: LogExtra;
};

export function maskPhone(phone: string) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (digits.length <= 4) return "***";
  return `${"*".repeat(Math.max(0, digits.length - 4))}${digits.slice(-4)}`;
}

export function logRequest(req: Request, meta: LogMeta) {
  const payload = {
    type: "request_log",
    method: req.method,
    route: meta.route,
    status: meta.status,
    durationMs: meta.durationMs,
    ...(meta.extra ? { extra: meta.extra } : {}),
    timestamp: new Date().toISOString(),
  };
  console.log(JSON.stringify(payload));
}
