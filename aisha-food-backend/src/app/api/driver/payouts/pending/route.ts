import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { ok, fail } from "@/lib/apiResponse";
import { assertNotInMaintenance } from "@/lib/maintenance";
import { cityCode } from "@/lib/city";
import { requireDriverCityContext } from "@/lib/driverContext";
import { loadPendingPayouts } from "@/lib/driverEarnings";

type ApiError = Error & { status?: number; code?: string };

export async function GET(req: Request) {
  try {
    await assertNotInMaintenance();
    await dbConnect();

    const { driver, city } = await requireDriverCityContext(req);
    const url = new URL(req.url);
    const weekKey = url.searchParams.get("weekKey") || undefined;

    const pending = await loadPendingPayouts({
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
      weekKey: pending.weekKey,
      totals: pending.totals,
      rows: pending.rows,
    });
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not load pending payouts.",
      err.status || 500
    );
  }
}
