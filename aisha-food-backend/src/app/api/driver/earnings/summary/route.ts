import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { ok, fail } from "@/lib/apiResponse";
import { assertNotInMaintenance } from "@/lib/maintenance";
import { cityCode } from "@/lib/city";
import { requireDriverCityContext } from "@/lib/driverContext";
import { loadEarningsSummary } from "@/lib/driverEarnings";

type ApiError = Error & { status?: number; code?: string };

export async function GET(req: Request) {
  try {
    await assertNotInMaintenance();
    await dbConnect();

    const { driver, city } = await requireDriverCityContext(req);
    const url = new URL(req.url);
    const weekKey = url.searchParams.get("weekKey") || undefined;

    const summary = await loadEarningsSummary({
      cityId: new mongoose.Types.ObjectId(String(city._id)),
      driverId: new mongoose.Types.ObjectId(String(driver._id)),
      weekKey,
    });

    return ok({
      city: {
        cityId: String(city._id),
        code: cityCode(city),
        name: String(city.name || ""),
        currency: String((city as { currency?: string }).currency || ""),
      },
      weekKey: summary.weekKey,
      pendingCount: summary.pendingCount,
      pendingAmount: summary.pendingAmount,
      paidCount: summary.paidCount,
      paidAmount: summary.paidAmount,
      lifetimePaidAmount: summary.lifetimePaidAmount,
      completedOrdersCount: summary.completedOrdersCount,
      completedOrders: summary.completedOrdersCount,
      deliveredCount: summary.completedOrdersCount,
      completedOrdersEarnings: summary.completedOrdersEarnings,
      totalEarnings: summary.totalEarnings,
      availableBalance: summary.pendingAmount,
      earningsSource: summary.earningsSource,
    });
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not load earnings summary.",
      err.status || 500
    );
  }
}
