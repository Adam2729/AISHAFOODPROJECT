import mongoose from "mongoose";
import { ok, fail } from "@/lib/apiResponse";
import { assertNotInMaintenance } from "@/lib/maintenance";
import { cityCode } from "@/lib/city";
import { requireDriverCityContext } from "@/lib/driverContext";
import { dbConnect } from "@/lib/mongodb";
import { Order } from "@/models/Order";

type ApiError = Error & { status?: number; code?: string };

export async function GET(req: Request) {
  try {
    await assertNotInMaintenance();
    await dbConnect();
    const { driver, city, authMode } = await requireDriverCityContext(req);
    const availability = String(driver.availability || "offline");
    const activeOrdersCount = await Order.countDocuments({
      cityId: new mongoose.Types.ObjectId(String(city._id)),
      "deliverySnapshot.mode": "platform_driver",
      "dispatch.assignedDriverId": new mongoose.Types.ObjectId(String(driver._id)),
      status: { $in: ["accepted", "preparing", "ready", "out_for_delivery"] },
    });

    return ok({
      authMode,
      driver: {
        id: String(driver._id),
        name: String(driver.name || ""),
        phone: String((driver as { phoneE164?: string | null }).phoneE164 || ""),
        email: String((driver as { email?: string | null }).email || ""),
        vehicleType: String((driver as { vehicleType?: string | null }).vehicleType || ""),
        status: driver.isBanned ? "banned" : driver.pausedAt ? "paused" : driver.isActive ? "active" : "inactive",
        accountStatus: driver.isBanned ? "banned" : driver.pausedAt ? "paused" : driver.isActive ? "active" : "inactive",
        zoneLabel: String(driver.zoneLabel || "").trim() || null,
        availability,
        eligibleForAvailableOrders:
          !driver.isBanned &&
          !driver.pausedAt &&
          Boolean(driver.isActive) &&
          availability === "available" &&
          activeOrdersCount === 0,
        activeOrdersCount,
        pausedAt: driver.pausedAt || null,
        pausedReason: String(driver.pausedReason || "").trim() || null,
        breakStartedAt: driver.breakStartedAt || null,
        breakReason: String(driver.breakReason || "").trim() || null,
        breakNote: String(driver.breakNote || "").trim() || null,
        lastSeenAt: driver.lastSeenAt || null,
        lastLocation: driver.lastLocation || null,
      },
      city: {
        cityId: String(city._id),
        code: cityCode(city),
        name: String(city.name || ""),
      },
    });
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not load driver profile.",
      err.status || 500
    );
  }
}
