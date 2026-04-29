import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { ok, fail } from "@/lib/apiResponse";
import { assertNotInMaintenance } from "@/lib/maintenance";
import { requireDriverCityContext } from "@/lib/driverContext";
import { DispatchAudit } from "@/models/DispatchAudit";
import { DriverAudit } from "@/models/DriverAudit";
import { Order } from "@/models/Order";

type ApiError = Error & { status?: number; code?: string };

export async function POST(
  req: Request,
  context: { params: Promise<{ orderId: string }> }
) {
  try {
    await assertNotInMaintenance();
    await dbConnect();

    const { driver, city } = await requireDriverCityContext(req);
    const { orderId } = await context.params;
    if (!mongoose.Types.ObjectId.isValid(orderId)) {
      return fail("VALIDATION_ERROR", "Valid orderId is required.", 400);
    }

    const cityIdObj = new mongoose.Types.ObjectId(String(city._id));
    const driverIdObj = new mongoose.Types.ObjectId(String(driver._id));
    const order = await Order.findOne({
      _id: new mongoose.Types.ObjectId(orderId),
      cityId: cityIdObj,
      "deliverySnapshot.mode": "platform_driver",
      "dispatch.assignedDriverId": driverIdObj,
      status: { $in: ["accepted", "preparing", "ready"] },
    })
      .select("_id businessId status dispatch.driverArrivedAt dispatch.pickupConfirmedAt")
      .lean<{
        _id: mongoose.Types.ObjectId;
        businessId: mongoose.Types.ObjectId;
        status?: string;
        dispatch?: {
          driverArrivedAt?: Date | null;
          pickupConfirmedAt?: Date | null;
        };
      } | null>();

    if (!order) {
      return fail("NOT_FOUND", "Assigned platform-driver order not found.", 404);
    }
    if (order.dispatch?.pickupConfirmedAt) {
      return fail("STATUS_NOT_ALLOWED", "Pickup is already confirmed for this order.", 409);
    }

    const arrivedAt = order.dispatch?.driverArrivedAt || new Date();
    if (!order.dispatch?.driverArrivedAt) {
      await Order.updateOne(
        {
          _id: order._id,
          cityId: cityIdObj,
          "dispatch.assignedDriverId": driverIdObj,
        },
        {
          $set: {
            "dispatch.driverArrivedAt": arrivedAt,
          },
        }
      );

      await Promise.all([
        DriverAudit.create({
          cityId: cityIdObj,
          driverId: driverIdObj,
          orderId: order._id,
          action: "DRIVER_ARRIVED_RESTAURANT",
          meta: {
            fromStatus: String(order.status || ""),
          },
        }),
        DispatchAudit.create({
          cityId: cityIdObj,
          orderId: order._id,
          businessId: order.businessId,
          driverId: driverIdObj,
          action: "DRIVER_ARRIVED_RESTAURANT",
          actor: "driver",
          meta: {
            cityId: cityIdObj,
            driverId: driverIdObj,
            selectedDriverId: driverIdObj,
            note: "driver_arrived_restaurant",
          },
        }),
      ]);
    }

    return ok({
      orderId: String(order._id),
      arrivedAtRestaurant: true,
      arrivedAt,
      idempotent: Boolean(order.dispatch?.driverArrivedAt),
    });
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not confirm restaurant arrival.",
      err.status || 500
    );
  }
}
