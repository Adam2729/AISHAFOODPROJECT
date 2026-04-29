import { dbConnect } from "@/lib/mongodb";
import { ok, fail } from "@/lib/apiResponse";
import {
  buildFilledDateSeries,
  resolveMerchantAnalyticsContext,
} from "@/lib/merchantAnalytics";
import { Order } from "@/models/Order";

type ApiError = Error & { status?: number; code?: string };

export async function GET(req: Request) {
  try {
    await dbConnect();
    const { businessId, range, startDate, endDate, timezone } =
      await resolveMerchantAnalyticsContext(req);

    const rows = await Order.aggregate([
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
      {
        $group: {
          _id: {
            $dateToString: {
              format: "%Y-%m-%d",
              date: "$createdAt",
              timezone,
            },
          },
          revenue: { $sum: { $ifNull: ["$total", 0] } },
          orders: { $sum: 1 },
        },
      },
      {
        $project: {
          _id: 0,
          date: "$_id",
          revenue: 1,
          orders: 1,
        },
      },
      { $sort: { date: 1 } },
    ]);

    return ok({
      days: buildFilledDateSeries(
        range,
        timezone,
        rows as Array<{ date: string; revenue?: number; orders?: number }>
      ),
    });
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not load merchant sales analytics.",
      err.status || 500
    );
  }
}
