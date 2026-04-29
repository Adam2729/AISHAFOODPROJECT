import { hashIp, hashSessionId } from "@/lib/pii";

type Bucket = {
  count: number;
  resetAt: number;
};

type RateLimitOptions = {
  limit: number;
  windowMs: number;
};

type RateLimitResult = {
  ok: boolean;
  retryAfterSec?: number;
  remaining: number;
  resetInMs: number;
};

type CompositeLimitInput = {
  key?: string | null;
  limit: number;
  windowMs: number;
};

type CompositeLimitResult = {
  ok: boolean;
  retryAfterSec?: number;
  checks: Array<{
    key: string;
    ok: boolean;
    retryAfterSec?: number;
  }>;
};

type IdentityInput = {
  phoneHash?: string | null;
  sessionId?: string | null;
};

const buckets = new Map<string, Bucket>();
let lastCleanupAt = 0;

function cleanupExpired(now: number) {
  // Avoid scanning on every request.
  if (now - lastCleanupAt < 30_000) return;
  lastCleanupAt = now;
  for (const [key, bucket] of buckets.entries()) {
    if (now >= bucket.resetAt) {
      buckets.delete(key);
    }
  }
}

export function rateLimitKeyed(key: string, options: RateLimitOptions): RateLimitResult {
  const now = Date.now();
  cleanupExpired(now);

  const normalizedKey = String(key || "").trim();
  const safeLimit = Math.max(1, Math.floor(Number(options.limit || 1)));
  const safeWindowMs = Math.max(1_000, Math.floor(Number(options.windowMs || 60_000)));

  if (!normalizedKey) {
    return {
      ok: true,
      remaining: safeLimit,
      resetInMs: safeWindowMs,
    };
  }

  const existing = buckets.get(normalizedKey);
  if (!existing || now >= existing.resetAt) {
    buckets.set(normalizedKey, { count: 1, resetAt: now + safeWindowMs });
    return {
      ok: true,
      remaining: Math.max(0, safeLimit - 1),
      resetInMs: safeWindowMs,
    };
  }

  existing.count += 1;
  const ok = existing.count <= safeLimit;
  const resetInMs = Math.max(0, existing.resetAt - now);
  return {
    ok,
    retryAfterSec: ok ? undefined : Math.max(1, Math.ceil(resetInMs / 1000)),
    remaining: Math.max(0, safeLimit - existing.count),
    resetInMs,
  };
}

export function rateLimitMany(checks: CompositeLimitInput[]): CompositeLimitResult {
  let maxRetry = 0;
  const results: CompositeLimitResult["checks"] = [];

  for (const check of checks) {
    const key = String(check.key || "").trim();
    if (!key) continue;
    const result = rateLimitKeyed(key, {
      limit: check.limit,
      windowMs: check.windowMs,
    });
    results.push({
      key,
      ok: result.ok,
      retryAfterSec: result.retryAfterSec,
    });
    if (!result.ok) {
      maxRetry = Math.max(maxRetry, Number(result.retryAfterSec || 0));
    }
  }

  return {
    ok: maxRetry <= 0,
    retryAfterSec: maxRetry > 0 ? maxRetry : undefined,
    checks: results,
  };
}

export function getClientIp(req: Request) {
  const cf = String(req.headers.get("cf-connecting-ip") || "").trim();
  if (cf) return cf;
  const forwarded = String(req.headers.get("x-forwarded-for") || "").trim();
  if (forwarded) return forwarded.split(",")[0].trim();
  return String(req.headers.get("x-real-ip") || "").trim();
}

export function buildRateLimitIdentity(req: Request, input?: IdentityInput) {
  const ip = getClientIp(req);
  const phoneHash = String(input?.phoneHash || "").trim();
  const sessionId = String(input?.sessionId || "").trim();
  return {
    ipHash: ip ? hashIp(ip) : "",
    phoneHash,
    sessionIdHash: sessionId ? hashSessionId(sessionId) : "",
  };
}

export function rateLimitPerIp(ipHash: string, options: RateLimitOptions) {
  return rateLimitKeyed(ipHash ? `ip:${ipHash}` : "", options);
}

export function rateLimitPerSession(sessionIdHash: string, options: RateLimitOptions) {
  return rateLimitKeyed(sessionIdHash ? `session:${sessionIdHash}` : "", options);
}

export function rateLimitPerPhoneHash(phoneHash: string, options: RateLimitOptions) {
  return rateLimitKeyed(phoneHash ? `phone:${phoneHash}` : "", options);
}

