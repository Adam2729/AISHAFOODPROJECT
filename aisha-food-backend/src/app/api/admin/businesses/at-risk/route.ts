import { dbConnect } from "@/lib/mongodb";
import { ok, fail } from "@/lib/apiResponse";
import { requireAdminKey } from "@/lib/adminAuth";
import { Business } from "@/models/Business";
import { Order } from "@/models/Order";

type ApiError = Error & { status?: number; code?: string };
type StaleNewOrdersAgg = {
  _id: string;
  staleNewOrdersCount24h: number;
  oldestStaleOrderCreatedAt: Date;
  newestStaleOrderCreatedAt: Date;
};

export async function GET(req: Request) {
  try {
    requireAdminKey(req);
    const url = new URL(req.url);
    const limitRaw = Number(url.searchParams.get("limit") || 20);
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(100, Math.floor(limitRaw))) : 20;
    const now = new Date();
    const staleCutoff = new Date(now.getTime() - 7 * 60 * 1000);
    const staleWindowStart = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    await dbConnect();
    const staleAgg = await Order.aggregate<StaleNewOrdersAgg>([
      {
        $match: {
          status: "new",
          createdAt: { $gte: staleWindowStart, $lte: staleCutoff },
        },
      },
      {
        $group: {
          _id: "$businessId",
          staleNewOrdersCount24h: { $sum: 1 },
          oldestStaleOrderCreatedAt: { $min: "$createdAt" },
          newestStaleOrderCreatedAt: { $max: "$createdAt" },
        },
      },
    ]);
    const staleMap = new Map(
      staleAgg.map((row) => [
        String(row._id),
        {
          staleNewOrdersCount24h: Number(row.staleNewOrdersCount24h || 0),
          oldestStaleOrderCreatedAt: row.oldestStaleOrderCreatedAt || null,
          newestStaleOrderCreatedAt: row.newestStaleOrderCreatedAt || null,
        },
      ])
    );
    const staleBusinessIds = staleAgg.map((row) => row._id);

    const businesses = await Business.find({
      $or: [
        { paused: true },
        { "health.complaintsCount": { $gte: 3 } },
        { "health.cancelsCount30d": { $gte: 5 } },
        { "health.slowAcceptCount30d": { $gte: 5 } },
        ...(staleBusinessIds.length ? [{ _id: { $in: staleBusinessIds } }] : []),
      ],
    })
      .select("name paused pausedReason pausedAt health updatedAt")
      .lean();

    const mapped = businesses.map((b) => {
      const stale = staleMap.get(String(b._id));
      const oldestStaleOrderMinutes =
        stale?.oldestStaleOrderCreatedAt instanceof Date
          ? Math.max(0, Math.round((now.getTime() - stale.oldestStaleOrderCreatedAt.getTime()) / 60000))
          : 0;
      return {
        id: String(b._id),
        name: b.name,
        paused: Boolean((b as { paused?: boolean }).paused),
        pausedReason: String((b as { pausedReason?: string }).pausedReason || ""),
        pausedAt: (b as { pausedAt?: Date | null }).pausedAt || null,
        updatedAt: b.updatedAt,
        staleNewOrdersCount24h: Number(stale?.staleNewOrdersCount24h || 0),
        oldestStaleOrderMinutes,
        newestStaleOrderCreatedAt: stale?.newestStaleOrderCreatedAt || null,
        health: {
          complaintsCount: Number((b as { health?: { complaintsCount?: number } }).health?.complaintsCount || 0),
          cancelsCount30d: Number((b as { health?: { cancelsCount30d?: number } }).health?.cancelsCount30d || 0),
          slowAcceptCount30d: Number((b as { health?: { slowAcceptCount30d?: number } }).health?.slowAcceptCount30d || 0),
          lastHealthUpdateAt:
            (b as { health?: { lastHealthUpdateAt?: Date | null } }).health?.lastHealthUpdateAt || null,
          lastHealthResetAt:
            (b as { health?: { lastHealthResetAt?: Date | null } }).health?.lastHealthResetAt || null,
        },
      };
    });
    mapped.sort((a, b) => {
      if (Number(b.paused) !== Number(a.paused)) return Number(b.paused) - Number(a.paused);
      if (b.staleNewOrdersCount24h !== a.staleNewOrdersCount24h) {
        return b.staleNewOrdersCount24h - a.staleNewOrdersCount24h;
      }
      if (b.oldestStaleOrderMinutes !== a.oldestStaleOrderMinutes) {
        return b.oldestStaleOrderMinutes - a.oldestStaleOrderMinutes;
      }
      const bComplaints = Number(b.health.complaintsCount || 0);
      const aComplaints = Number(a.health.complaintsCount || 0);
      if (bComplaints !== aComplaints) return bComplaints - aComplaints;
      const bCancels = Number(b.health.cancelsCount30d || 0);
      const aCancels = Number(a.health.cancelsCount30d || 0);
      if (bCancels !== aCancels) return bCancels - aCancels;
      return Number(new Date(b.updatedAt || 0).getTime()) - Number(new Date(a.updatedAt || 0).getTime());
    });

    return ok({
      businesses: mapped.slice(0, limit),
    });
  } catch (e: unknown) {
    const err = e as ApiError;
    return fail(err.code || "SERVER_ERROR", err.message || "Could not load at-risk businesses.", err.status || 500);
  }
}
