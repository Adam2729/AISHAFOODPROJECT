import { dbConnect } from "@/lib/mongodb";
import { ok, fail } from "@/lib/apiResponse";
import { resolveMerchantAnalyticsContext } from "@/lib/merchantAnalytics";
import { Order } from "@/models/Order";

type ApiError = Error & { status?: number; code?: string };

export async function GET(req: Request) {
  try {
    await dbConnect();
    const { businessId, startDate, endDate } = await resolveMerchantAnalyticsContext(req);

    const items = await Order.aggregate([
      {
        $match: {
          businessId,
          status: "delivered",
          createdAt: {
            $gte: startDate,
            $lte: endDate,
          },
        },
      },
      { $unwind: "$items" },
      {
        $group: {
          _id: "$items.name",
          quantitySold: { $sum: { $ifNull: ["$items.qty", 0] } },
          revenue: { $sum: { $ifNull: ["$items.lineTotal", 0] } },
        },
      },
      {
        $project: {
          _id: 0,
          name: "$_id",
          quantitySold: 1,
          revenue: 1,
        },
      },
      { $sort: { quantitySold: -1, revenue: -1, name: 1 } },
      { $limit: 10 },
    ]);

    return ok({
      items: (items || []).map((item) => ({
        name: String(item.name || ""),
        quantitySold: Number(item.quantitySold || 0),
        revenue: Number(item.revenue || 0),
      })),
    });
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not load top-selling items.",
      err.status || 500
    );
  }
}
