type RateBucket = {
  count: number;
  resetAt: number;
};

const buckets = new Map<string, RateBucket>();

export function consumeRateLimit(key: string, limit: number, windowMs: number) {
  const now = Date.now();
  const safeLimit = Math.max(1, Math.floor(limit));
  const safeWindow = Math.max(1000, Math.floor(windowMs));
  const bucketKey = String(key || "").trim();

  if (!bucketKey) {
    return {
      allowed: true,
      remaining: safeLimit,
      resetInMs: safeWindow,
    };
  }

  const current = buckets.get(bucketKey);
  if (!current || now >= current.resetAt) {
    const next: RateBucket = {
      count: 1,
      resetAt: now + safeWindow,
    };
    buckets.set(bucketKey, next);
    return {
      allowed: true,
      remaining: Math.max(0, safeLimit - 1),
      resetInMs: safeWindow,
    };
  }

  current.count += 1;
  const allowed = current.count <= safeLimit;
  return {
    allowed,
    remaining: Math.max(0, safeLimit - current.count),
    resetInMs: Math.max(0, current.resetAt - now),
  };
}
