import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { ok, fail } from "@/lib/apiResponse";
import { assertNotInMaintenance } from "@/lib/maintenance";
import { cityCode } from "@/lib/city";
import { requireDriverCityContext } from "@/lib/driverContext";
import { loadReconciliationPreview } from "@/lib/driverEarnings";

type ApiError = Error & { status?: number; code?: string };

export async function GET(req: Request) {
  try {
    await assertNotInMaintenance();
    await dbConnect();

    const { driver, city } = await requireDriverCityContext(req);
    const url = new URL(req.url);
    const weekKey = url.searchParams.get("weekKey") || undefined;

    const preview = await loadReconciliationPreview({
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
      weekKey: preview.weekKey,
      driverId: String(driver._id),
      cashCollectedByRider: preview.totals.cashCollectedByRider,
      cashDueToRider: preview.totals.cashDueToRider,
      cashDueToPlatform: preview.totals.cashDueToPlatform,
      netSettlement: preview.totals.netSettlement,
      rows: preview.rows,
    });
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not load reconciliation preview.",
      err.status || 500
    );
  }
}
