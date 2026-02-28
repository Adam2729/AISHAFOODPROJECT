import { createHash } from "node:crypto";
import { dbConnect } from "@/lib/mongodb";
import { RateLimitHit } from "@/models/RateLimitHit";

type RateLimitScope =
  | "public.orders.phone"
  | "public.complaints.phone"
  | "public.reviews.phone"
  | "public.funnel.session";

type HitOptions = {
  windowSec: number;
  limit: number;
};

type HitResult = {
  allowed: boolean;
  remaining: number;
  resetAtIso: string;
};

function sha256(input: string) {
  return createHash("sha256").update(input).digest("hex");
}

function normalizeWindowSec(value: number) {
  const parsed = Math.floor(Number(value || 0));
  return Math.max(1, parsed);
}

function normalizeLimit(value: number) {
  const parsed = Math.floor(Number(value || 0));
  return Math.max(1, parsed);
}

export async function hit(
  scope: RateLimitScope,
  rawKey: string,
  options: HitOptions
): Promise<HitResult> {
  const normalizedKey = String(rawKey || "").trim();
  const windowSec = normalizeWindowSec(options.windowSec);
  const limit = normalizeLimit(options.limit);
  const nowMs = Date.now();
  const bucket = Math.floor(nowMs / (windowSec * 1000));
  const resetAtMs = (bucket + 1) * windowSec * 1000;
  const resetAtIso = new Date(resetAtMs).toISOString();

  if (!normalizedKey) {
    return {
      allowed: true,
      remaining: limit,
      resetAtIso,
    };
  }

  await dbConnect();
  const keyHash = sha256(normalizedKey);
  const windowKey = String(bucket);

  const row = await RateLimitHit.findOneAndUpdate(
    { scope, keyHash, windowKey },
    {
      $inc: { count: 1 },
      $setOnInsert: {
        scope,
        keyHash,
        windowKey,
      },
    },
    { upsert: true, returnDocument: "after" }
  )
    .select("count")
    .lean<{ count?: number } | null>();

  const count = Math.max(0, Number(row?.count || 0));
  const allowed = count <= limit;
  return {
    allowed,
    remaining: Math.max(0, limit - count),
    resetAtIso,
  };
}
