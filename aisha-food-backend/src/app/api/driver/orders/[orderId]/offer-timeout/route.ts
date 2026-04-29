import mongoose from "mongoose";
import { ok, fail } from "@/lib/apiResponse";
import { assertNotInMaintenance } from "@/lib/maintenance";
import { requireDriverCityContext } from "@/lib/driverContext";
import { dbConnect } from "@/lib/mongodb";
import { expireDriverOfferForOrder } from "@/lib/driverDispatchOffers";

type ApiError = Error & { status?: number; code?: string };

export async function POST(
  req: Request,
  context: { params: Promise<{ orderId: string }> }
) {
  try {
    await assertNotInMaintenance();
    await dbConnect();

    const { city, driver } = await requireDriverCityContext(req);
    const { orderId } = await context.params;
    if (!mongoose.Types.ObjectId.isValid(orderId)) {
      return fail("VALIDATION_ERROR", "Valid orderId is required.", 400);
    }

    const result = await expireDriverOfferForOrder({
      orderId: new mongoose.Types.ObjectId(orderId),
      cityId: new mongoose.Types.ObjectId(String(city._id)),
      driverId: new mongoose.Types.ObjectId(String(driver._id)),
      actor: "driver",
      source: "driver.orders.offer_timeout",
      reason: "offer_timeout",
      response: "expired",
      triggerNext: true,
    });

    return ok({
      orderId,
      timedOut: Boolean(result?.expired),
      nextOfferStatus: result?.nextStatus || null,
      nextOffer: result?.nextOffer || null,
    });
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not expire driver order offer.",
      err.status || 500
    );
  }
}
