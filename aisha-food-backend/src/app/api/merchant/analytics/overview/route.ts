import { dbConnect } from "@/lib/mongodb";
import { ok, fail } from "@/lib/apiResponse";
import { resolveMerchantAnalyticsContext } from "@/lib/merchantAnalytics";
import { Order } from "@/models/Order";

type ApiError = Error & { status?: number; code?: string };

export async function GET(req: Request) {
  try {
    await dbConnect();
    const { businessId, startDate, endDate } = await resolveMerchantAnalyticsContext(req);

    const rows = await Order.aggregate([
      {
        $match: {
          businessId,
          createdAt: {
            $gte: startDate,
            $lte: endDate,
          },
        },
      },
      {
        $group: {
          _id: null,
          ordersTotal: { $sum: 1 },
          ordersDelivered: {
            $sum: {
              $cond: [{ $eq: ["$status", "delivered"] }, 1, 0],
            },
          },
          ordersCancelled: {
            $sum: {
              $cond: [{ $eq: ["$status", "cancelled"] }, 1, 0],
            },
          },
          revenueTotal: {
            $sum: {
              $cond: [
                { $eq: ["$status", "delivered"] },
                { $ifNull: ["$total", 0] },
                0,
              ],
            },
          },
        },
      },
    ]);

    const summary = rows[0] || {};
    const ordersDelivered = Number(summary.ordersDelivered || 0);
    const revenueTotal = Number(summary.revenueTotal || 0);

    return ok({
      ordersTotal: Number(summary.ordersTotal || 0),
      ordersDelivered,
      ordersCancelled: Number(summary.ordersCancelled || 0),
      revenueTotal,
      averageOrderValue: ordersDelivered > 0 ? revenueTotal / ordersDelivered : 0,
    });
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not load merchant analytics overview.",
      err.status || 500
    );
  }
}
