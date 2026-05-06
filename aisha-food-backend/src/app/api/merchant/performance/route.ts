import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { ok, fail } from "@/lib/apiResponse";
import { requireMerchantSession } from "@/lib/merchantAuth";
import { requireMerchantBusinessAvailable } from "@/lib/merchantBusiness";
import { Order } from "@/models/Order";

type ApiError = Error & { status?: number; code?: string };

export const dynamic = "force-dynamic";

function numberValue(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function GET(req: Request) {
  try {
    const session = requireMerchantSession(req);
    if (!mongoose.Types.ObjectId.isValid(session.businessId)) {
      return fail("UNAUTHORIZED", "Invalid merchant session.", 401);
    }

    await dbConnect();
    await requireMerchantBusinessAvailable(session.businessId);

    const businessId = new mongoose.Types.ObjectId(session.businessId);
    const now = new Date();
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - 6);
    weekStart.setHours(0, 0, 0, 0);
    const todayKey = now.toISOString().slice(0, 10);

    const orders = await Order.find({
      businessId,
      createdAt: { $gte: weekStart },
    }).lean();

    const deliveredOrders = orders.filter((order) => String(order.status || "") === "delivered");
    const todaySales = deliveredOrders
      .filter((order) => String(order.createdAt || "").startsWith(todayKey))
      .reduce((sum, order) => sum + numberValue(order.orderTotal ?? order.total), 0);
    const weeklySales = deliveredOrders.reduce(
      (sum, order) => sum + numberValue(order.orderTotal ?? order.total),
      0
    );

    const topDishMap = new Map<string, { name: string; quantity: number; revenue: number }>();
    for (const order of deliveredOrders) {
      const items = Array.isArray(order.items) ? order.items : [];
      for (const item of items) {
        const name = String(item?.name || "Item").trim() || "Item";
        const quantity = Math.max(0, Number(item?.qty ?? item?.quantity ?? 0));
        const lineRevenue = quantity * numberValue(item?.unitPrice ?? item?.price ?? item?.productPrice);
        const existing = topDishMap.get(name) || { name, quantity: 0, revenue: 0 };
        existing.quantity += quantity;
        existing.revenue += lineRevenue;
        topDishMap.set(name, existing);
      }
    }

    const prepSamples = orders
      .map((order) => {
        const acceptedAt = order.statusTimestamps?.acceptedAt
          ? new Date(order.statusTimestamps.acceptedAt)
          : null;
        const readyAt = order.statusTimestamps?.readyAt
          ? new Date(order.statusTimestamps.readyAt)
          : null;
        if (!acceptedAt || !readyAt) return null;
        const diffMs = readyAt.getTime() - acceptedAt.getTime();
        if (!Number.isFinite(diffMs) || diffMs <= 0) return null;
        return Math.round(diffMs / 60000);
      })
      .filter((value): value is number => value != null);

    return ok({
      todaySales,
      weeklySales,
      topDishes: Array.from(topDishMap.values())
        .sort((left, right) => right.quantity - left.quantity || right.revenue - left.revenue)
        .slice(0, 5),
      missedOrders: orders.filter((order) => String(order.status || "") === "new").length,
      averagePrepTime: prepSamples.length
        ? Math.round(prepSamples.reduce((sum, value) => sum + value, 0) / prepSamples.length)
        : 0,
      acceptedOrders: orders.filter((order) => String(order.status || "") === "accepted").length,
      rejectedOrders: orders.filter((order) => String(order.status || "") === "rejected").length,
      readyOrders: orders.filter((order) => String(order.status || "") === "ready").length,
      cancelledOrders: orders.filter((order) => String(order.status || "") === "cancelled").length,
    });
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not load merchant performance.",
      err.status || 500
    );
  }
}
