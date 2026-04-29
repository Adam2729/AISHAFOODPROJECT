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
      status: "out_for_delivery",
    })
      .select("_id businessId status dispatch.arrivedAtCustomerAt")
      .lean<{
        _id: mongoose.Types.ObjectId;
        businessId: mongoose.Types.ObjectId;
        status?: string;
        dispatch?: {
          arrivedAtCustomerAt?: Date | null;
        };
      } | null>();

    if (!order) {
      return fail("NOT_FOUND", "Out-for-delivery platform-driver order not found.", 404);
    }

    const arrivedAt = order.dispatch?.arrivedAtCustomerAt || new Date();
    if (!order.dispatch?.arrivedAtCustomerAt) {
      await Order.updateOne(
        {
          _id: order._id,
          cityId: cityIdObj,
          "dispatch.assignedDriverId": driverIdObj,
          status: "out_for_delivery",
        },
        {
          $set: {
            "dispatch.arrivedAtCustomerAt": arrivedAt,
          },
        }
      );

      await Promise.all([
        DriverAudit.create({
          cityId: cityIdObj,
          driverId: driverIdObj,
          orderId: order._id,
          action: "DRIVER_ARRIVED_CUSTOMER",
          meta: {
            fromStatus: String(order.status || ""),
          },
        }),
        DispatchAudit.create({
          cityId: cityIdObj,
          orderId: order._id,
          businessId: order.businessId,
          driverId: driverIdObj,
          action: "DRIVER_ARRIVED_CUSTOMER",
          actor: "driver",
          meta: {
            cityId: cityIdObj,
            driverId: driverIdObj,
            selectedDriverId: driverIdObj,
            note: "driver_arrived_customer",
          },
        }),
      ]);
    }

    return ok({
      orderId: String(order._id),
      arrivedAtCustomer: true,
      arrivedAt,
      idempotent: Boolean(order.dispatch?.arrivedAtCustomerAt),
    });
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not confirm customer arrival.",
      err.status || 500
    );
  }
}
