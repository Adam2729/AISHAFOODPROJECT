import { dbConnect } from "@/lib/mongodb";
import { ok, fail } from "@/lib/apiResponse";
import { requireAdminKey } from "@/lib/adminAuth";
import { Business } from "@/models/Business";

type ApiError = Error & { status?: number; code?: string };

export async function GET(req: Request) {
  try {
    requireAdminKey(req);
    const url = new URL(req.url);
    const limitRaw = Number(url.searchParams.get("limit") || 20);
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(100, Math.floor(limitRaw))) : 20;

    await dbConnect();
    const businesses = await Business.find({
      $or: [
        { paused: true },
        { "health.complaintsCount": { $gte: 3 } },
        { "health.cancelsCount30d": { $gte: 5 } },
        { "health.slowAcceptCount30d": { $gte: 5 } },
      ],
    })
      .sort({
        paused: -1,
        "health.complaintsCount": -1,
        "health.cancelsCount30d": -1,
        "health.slowAcceptCount30d": -1,
        updatedAt: -1,
      })
      .limit(limit)
      .select("name paused pausedReason pausedAt health updatedAt")
      .lean();

    return ok({
      businesses: businesses.map((b) => ({
        id: String(b._id),
        name: b.name,
        paused: Boolean((b as { paused?: boolean }).paused),
        pausedReason: String((b as { pausedReason?: string }).pausedReason || ""),
        pausedAt: (b as { pausedAt?: Date | null }).pausedAt || null,
        updatedAt: b.updatedAt,
        health: {
          complaintsCount: Number((b as { health?: { complaintsCount?: number } }).health?.complaintsCount || 0),
          cancelsCount30d: Number((b as { health?: { cancelsCount30d?: number } }).health?.cancelsCount30d || 0),
          slowAcceptCount30d: Number((b as { health?: { slowAcceptCount30d?: number } }).health?.slowAcceptCount30d || 0),
          lastHealthUpdateAt:
            (b as { health?: { lastHealthUpdateAt?: Date | null } }).health?.lastHealthUpdateAt || null,
          lastHealthResetAt:
            (b as { health?: { lastHealthResetAt?: Date | null } }).health?.lastHealthResetAt || null,
        },
      })),
    });
  } catch (e: unknown) {
    const err = e as ApiError;
    return fail(err.code || "SERVER_ERROR", err.message || "Could not load at-risk businesses.", err.status || 500);
  }
}

