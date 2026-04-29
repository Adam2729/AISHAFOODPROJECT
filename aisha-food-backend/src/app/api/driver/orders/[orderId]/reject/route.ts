import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { ok, fail, readJson } from "@/lib/apiResponse";
import { assertNotInMaintenance } from "@/lib/maintenance";
import { requireDriverCityContext } from "@/lib/driverContext";
import {
  buildDispatchUnassignSet,
  expireDriverOfferForOrder,
  offerNextDriverForOrder,
} from "@/lib/driverDispatchOffers";
import { DispatchAudit } from "@/models/DispatchAudit";
import { DriverAudit } from "@/models/DriverAudit";
import { Driver } from "@/models/Driver";
import { Order } from "@/models/Order";

type ApiError = Error & { status?: number; code?: string };

type Body = {
  reason?: string;
  note?: string;
};

const ACTIVE_PLATFORM_STATUSES = ["accepted", "preparing", "ready"] as const;

function cleanText(value: unknown, max: number) {
  return String(value || "").trim().slice(0, max);
}

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

    const body = await readJson<Body>(req).catch(() => ({} as Body));
    const note = cleanText(body.note || body.reason, 200);
    const cityIdObj = new mongoose.Types.ObjectId(String(city._id));
    const driverIdObj = new mongoose.Types.ObjectId(String(driver._id));
    const orderObjectId = new mongoose.Types.ObjectId(orderId);

    const order = await Order.findOne({
      _id: orderObjectId,
      cityId: cityIdObj,
      "deliverySnapshot.mode": "platform_driver",
      status: { $in: [...ACTIVE_PLATFORM_STATUSES] },
    })
      .select(
        "_id businessId status dispatch.assignedDriverId dispatch.currentOfferDriverId dispatch.pickupConfirmedAt"
      )
      .lean<{
        _id: mongoose.Types.ObjectId;
        businessId: mongoose.Types.ObjectId;
        status?: string;
        dispatch?: {
          assignedDriverId?: mongoose.Types.ObjectId | null;
          currentOfferDriverId?: mongoose.Types.ObjectId | null;
          pickupConfirmedAt?: Date | null;
        };
      } | null>();

    if (!order) {
      return fail("NOT_FOUND", "Platform-driver order not found.", 404);
    }

    const assignedDriverId = String(order.dispatch?.assignedDriverId || "");
    const offeredDriverId = String(order.dispatch?.currentOfferDriverId || "");
    const isAssignedToCurrentDriver = assignedDriverId === String(driver._id);
    const isCurrentOfferedDriver = !assignedDriverId && offeredDriverId === String(driver._id);

    if (!isAssignedToCurrentDriver && !isCurrentOfferedDriver) {
      if (assignedDriverId) {
        return fail("ORDER_ALREADY_ASSIGNED", "Order is already assigned to another driver.", 409);
      }
      return fail("ORDER_NOT_AVAILABLE", "This order is no longer available.", 409);
    }

    if (order.dispatch?.pickupConfirmedAt) {
      return fail("STATUS_NOT_ALLOWED", "Orders cannot be rejected after pickup.", 409);
    }

    const now = new Date();

    if (isCurrentOfferedDriver) {
      const expired = await expireDriverOfferForOrder({
        orderId: order._id,
        cityId: cityIdObj,
        driverId: driverIdObj,
        actor: "driver",
        source: "driver.orders.reject",
        reason: note || "driver_rejected_offer",
        response: "rejected",
        triggerNext: true,
      });

      await DriverAudit.create({
        cityId: cityIdObj,
        driverId: driverIdObj,
        orderId: order._id,
        action: "ORDER_REJECTED",
        meta: {
          releaseToPool: false,
          fromStatus: String(order.status || ""),
          note: note || null,
          rejectedAt: now,
        },
      });

      return ok({
        orderId: String(order._id),
        rejected: true,
        releaseToPool: false,
        rejectedAt: now,
        nextOfferStatus: expired?.nextStatus || null,
      });
    }

    await Order.updateOne(
      {
        _id: order._id,
        cityId: cityIdObj,
        "dispatch.assignedDriverId": driverIdObj,
        "deliverySnapshot.mode": "platform_driver",
        "dispatch.pickupConfirmedAt": null,
      },
      {
        $set: {
          ...buildDispatchUnassignSet("waiting_for_driver"),
          "dispatch.driverArrivedAt": null,
          "dispatch.arrivedAtCustomerAt": null,
          "dispatch.paymentCollectedAt": null,
          "dispatch.paymentCollectionMethod": null,
          "dispatch.paymentCollectionProvider": null,
          "dispatch.paymentCollectionReference": null,
          "dispatch.paymentCollectionNote": null,
          "dispatch.handoffNote": note || null,
          "dispatch.dispatchAttempts.$[offer].respondedAt": now,
          "dispatch.dispatchAttempts.$[offer].response": "released",
          "dispatch.dispatchAttempts.$[offer].reason": note || "driver_released_assignment",
        },
      },
      {
        arrayFilters: [
          {
            "offer.driverId": driverIdObj,
            "offer.response": "accepted",
          },
        ],
      }
    );

    const remainingAssignedOrders = await Order.countDocuments({
      cityId: cityIdObj,
      "deliverySnapshot.mode": "platform_driver",
      "dispatch.assignedDriverId": driverIdObj,
      status: { $in: ["accepted", "preparing", "ready", "out_for_delivery"] },
    });

    await Driver.updateOne(
      { _id: driverIdObj, cityId: cityIdObj },
      {
        $set: {
          availability:
            driver.pausedAt
              ? "paused"
              : remainingAssignedOrders > 0
              ? "busy"
              : "available",
          lastSeenAt: now,
        },
      }
    ).catch(() => null);

    await DispatchAudit.create({
      cityId: cityIdObj,
      orderId: order._id,
      businessId: order.businessId,
      driverId: driverIdObj,
      action: "ORDER_REJECTED",
      actor: "driver",
      meta: {
        cityId: cityIdObj,
        driverId: driverIdObj,
        selectedDriverId: driverIdObj,
        previousDriverId: driverIdObj,
        reason: note || "driver_rejected_assignment",
        note: "driver_reject_release",
      },
    });

    await DriverAudit.create({
      cityId: cityIdObj,
      driverId: driverIdObj,
      orderId: order._id,
      action: "ORDER_REJECTED",
      meta: {
        releaseToPool: true,
        fromStatus: String(order.status || ""),
        note: note || null,
        rejectedAt: now,
      },
    });

    const next = await offerNextDriverForOrder({
      orderId: order._id,
      cityId: cityIdObj,
      actor: "system",
      source: "driver.orders.reject.release",
      note: note || "driver_released_assignment",
      excludeDriverIds: [driverIdObj],
    });

    return ok({
      orderId: String(order._id),
      rejected: true,
      releaseToPool: true,
      rejectedAt: now,
      nextOfferStatus: next.status,
    });
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not reject driver order.",
      err.status || 500
    );
  }
}
