import mongoose from "mongoose";
import { ok, fail } from "@/lib/apiResponse";
import { assertNotInMaintenance } from "@/lib/maintenance";
import { cityCode } from "@/lib/city";
import { requireDriverCityContext } from "@/lib/driverContext";
import { dbConnect } from "@/lib/mongodb";
import { loadCurrentDriverOffer } from "@/lib/driverDispatchOffers";

type ApiError = Error & { status?: number; code?: string };

export async function GET(req: Request) {
  try {
    await assertNotInMaintenance();
    await dbConnect();

    const { city, driver } = await requireDriverCityContext(req);
    const offer = await loadCurrentDriverOffer({
      cityId: new mongoose.Types.ObjectId(String(city._id)),
      driverId: new mongoose.Types.ObjectId(String(driver._id)),
    });

    return ok({
      city: {
        cityId: String(city._id),
        code: cityCode(city),
        name: String(city.name || ""),
      },
      driver: {
        id: String(driver._id),
        availability: String(driver.availability || "offline"),
      },
      offer,
    });
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not load current order offer.",
      err.status || 500
    );
  }
}
