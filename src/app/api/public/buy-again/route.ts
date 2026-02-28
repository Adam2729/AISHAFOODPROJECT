import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { ok, fail } from "@/lib/apiResponse";
import { assertNotInMaintenance } from "@/lib/maintenance";
import { consumeRateLimit } from "@/lib/requestRateLimit";
import { normalizePhone, phoneToHash } from "@/lib/phoneHash";
import { Order } from "@/models/Order";

type ApiError = Error & { status?: number; code?: string };
type BuyAgainAgg = {
  _id: mongoose.Types.ObjectId;
  name: string;
  orderCount: number;
  lastOrderedAt: Date;
  lastUnitPrice: number;
};

function parseLimit(raw: string | null) {
  const parsed = Number(raw || 10);
  if (!Number.isFinite(parsed)) return 10;
  return Math.max(1, Math.min(20, Math.floor(parsed)));
}

export async function GET(req: Request) {
  try {
    await assertNotInMaintenance();

    const url = new URL(req.url);
    const phoneRaw = String(url.searchParams.get("phone") || "").trim();
    const businessId = String(url.searchParams.get("businessId") || "").trim();
    const limit = parseLimit(url.searchParams.get("limit"));
    if (!phoneRaw || !businessId) {
      return fail("VALIDATION_ERROR", "phone and businessId are required.", 400);
    }
    if (!mongoose.Types.ObjectId.isValid(businessId)) {
      return fail("VALIDATION_ERROR", "Invalid businessId.", 400);
    }

    const normalizedPhone = normalizePhone(phoneRaw);
    if (!normalizedPhone) {
      return fail("VALIDATION_ERROR", "Invalid phone.", 400);
    }
    const phoneHash = phoneToHash(normalizedPhone);
    const limitState = consumeRateLimit(`public-buy-again:${phoneHash}`, 30, 10 * 60 * 1000);
    if (!limitState.allowed) {
      return fail("RATE_LIMIT", "Too many requests. Try later.", 429);
    }

    await dbConnect();
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    const items = await Order.aggregate<BuyAgainAgg>([
      {
        $match: {
          businessId: new mongoose.Types.ObjectId(businessId),
          phoneHash,
          status: "delivered",
          createdAt: { $gte: ninetyDaysAgo },
        },
      },
      { $sort: { createdAt: -1 } },
      { $limit: 200 },
      { $unwind: "$items" },
      {
        $group: {
          _id: "$items.productId",
          name: { $first: "$items.name" },
          orderCount: { $sum: 1 },
          lastOrderedAt: { $max: "$createdAt" },
          lastUnitPrice: { $first: "$items.unitPrice" },
        },
      },
      { $sort: { orderCount: -1, lastOrderedAt: -1 } },
      { $limit: limit },
    ]);

    return ok({
      items: items.map((item) => ({
        productId: String(item._id),
        name: String(item.name || ""),
        orderCount: Number(item.orderCount || 0),
        lastOrderedAt: item.lastOrderedAt,
        lastUnitPrice: Number(item.lastUnitPrice || 0),
      })),
    });
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(err.code || "SERVER_ERROR", err.message || "Could not load buy-again items.", err.status || 500);
  }
}

