import { dbConnect } from "@/lib/mongodb";
import { ok, fail } from "@/lib/apiResponse";
import {
  buildFilledHourSeries,
  resolveMerchantAnalyticsContext,
} from "@/lib/merchantAnalytics";
import { Order } from "@/models/Order";

type ApiError = Error & { status?: number; code?: string };

export async function GET(req: Request) {
  try {
    await dbConnect();
    const { businessId, startDate, endDate, timezone } =
      await resolveMerchantAnalyticsContext(req);

    const rows = await Order.aggregate([
      {
        $match: {
          businessId,
          status: { $ne: "cancelled" },
          createdAt: {
            $gte: startDate,
            $lte: endDate,
          },
        },
      },
      {
        $group: {
          _id: {
            $hour: {
              date: "$createdAt",
              timezone,
            },
          },
          orders: { $sum: 1 },
        },
      },
      {
        $project: {
          _id: 0,
          hour: "$_id",
          orders: 1,
        },
      },
      { $sort: { hour: 1 } },
    ]);

    return ok({
      hours: buildFilledHourSeries(
        (rows || []) as Array<{ hour: number; orders?: number }>
      ),
    });
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not load peak-hours analytics.",
      err.status || 500
    );
  }
}
