import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { ok, fail } from "@/lib/apiResponse";
import { requireMerchantSession } from "@/lib/merchantAuth";
import { requireMerchantBusinessAvailable } from "@/lib/merchantBusiness";
import { Order } from "@/models/Order";

type ApiError = Error & { status?: number; code?: string };

function parseLimit(raw: string | null) {
  const parsed = Number(raw || 20);
  if (!Number.isFinite(parsed)) return 20;
  return Math.max(1, Math.min(50, Math.floor(parsed)));
}

function parseSince(raw: string | null) {
  const value = String(raw || "").trim();
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

export async function GET(req: Request) {
  try {
    const session = requireMerchantSession(req);
    if (!mongoose.Types.ObjectId.isValid(session.businessId)) {
      return fail("UNAUTHORIZED", "Invalid merchant session.", 401);
    }

    const url = new URL(req.url);
    const limit = parseLimit(url.searchParams.get("limit"));
    const since = parseSince(url.searchParams.get("since"));

    await dbConnect();
    await requireMerchantBusinessAvailable(session.businessId);

    const filter: Record<string, unknown> = {
      businessId: new mongoose.Types.ObjectId(session.businessId),
    };
    if (since) {
      filter.createdAt = { $gt: since };
    }

    const orders = await Order.find(filter)
      .sort({ createdAt: -1 })
      .limit(limit)
      .select("_id orderNumber status createdAt subtotal total")
      .lean();

    return ok({
      now: new Date().toISOString(),
      orders: orders.map((order) => ({
        orderId: String(order._id),
        orderNumber: String(order.orderNumber || ""),
        status: String(order.status || ""),
        createdAt: order.createdAt,
        subtotal: Number(order.subtotal || 0),
        total: Number(order.total || 0),
      })),
    });
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not load merchant order digest.",
      err.status || 500
    );
  }
}
