import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { ok, fail } from "@/lib/apiResponse";
import { assertNotInMaintenance } from "@/lib/maintenance";
import { requireDriverCityContext } from "@/lib/driverContext";
import { buildDispatchAssignmentSet } from "@/lib/driverDispatchOffers";
import {
  queueDriverAssignedNotifications,
  settleNotificationWrites,
} from "@/lib/notificationEvents";
import { DispatchAudit } from "@/models/DispatchAudit";
import { Driver } from "@/models/Driver";
import { Order } from "@/models/Order";

type ApiError = Error & { status?: number; code?: string };

const OFFER_ACCEPTABLE_STATUSES = ["accepted", "preparing", "ready"] as const;

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

    const now = new Date();
    const cityIdObj = new mongoose.Types.ObjectId(String(city._id));
    const driverIdObj = new mongoose.Types.ObjectId(String(driver._id));
    const orderObjectId = new mongoose.Types.ObjectId(orderId);
    const driverName = String(driver.name || "").trim() || null;
    const driverAvailability = String(driver.availability || "offline");

    if (driver.pausedAt || driverAvailability !== "available") {
      const existing = await Order.findById(orderObjectId)
        .select("_id cityId deliverySnapshot.mode dispatch.assignedDriverId status")
        .lean<{
          _id: mongoose.Types.ObjectId;
          cityId?: mongoose.Types.ObjectId | null;
          deliverySnapshot?: { mode?: string | null };
          dispatch?: { assignedDriverId?: mongoose.Types.ObjectId | null };
          status?: string;
        } | null>();

      if (
        existing &&
        String(existing.cityId || "") === String(city._id) &&
        String(existing.deliverySnapshot?.mode || "") === "platform_driver" &&
        String(existing.dispatch?.assignedDriverId || "") === String(driver._id)
      ) {
        return ok({
          orderId: String(existing._id),
          driverId: String(driver._id),
          accepted: true,
          idempotent: true,
          status: String(existing.status || ""),
        });
      }

      if (driver.pausedAt) {
        return fail("DRIVER_NOT_ELIGIBLE", "Driver account is paused and cannot accept orders.", 409);
      }
      if (driverAvailability === "paused") {
        return fail("DRIVER_ON_BREAK", "End your break before accepting available orders.", 409);
      }
      return fail("DRIVER_NOT_AVAILABLE", "Go online before accepting available orders.", 409);
    }

    const updated = await Order.findOneAndUpdate(
      {
        _id: orderObjectId,
        cityId: cityIdObj,
        "deliverySnapshot.mode": "platform_driver",
        "dispatch.assignedDriverId": null,
        "dispatch.currentOfferDriverId": driverIdObj,
        "dispatch.offerExpiresAt": { $gt: now },
        status: { $in: [...OFFER_ACCEPTABLE_STATUSES] },
      },
      {
        $set: {
          ...buildDispatchAssignmentSet({
            driverId: driverIdObj,
            driverName,
            assignedAt: now,
            dispatchStatus: "driver_accepted",
          }),
          "dispatch.dispatchAttempts.$[offer].respondedAt": now,
          "dispatch.dispatchAttempts.$[offer].response": "accepted",
          "dispatch.dispatchAttempts.$[offer].reason": "accepted",
        },
      },
      {
        new: true,
        arrayFilters: [
          {
            "offer.driverId": driverIdObj,
            "offer.response": "offered",
          },
        ],
      }
    )
      .select(
        "_id businessId orderNumber phoneHash status dispatch.assignedDriverId dispatch.assignedAt"
      )
      .lean<{
        _id: mongoose.Types.ObjectId;
        businessId: mongoose.Types.ObjectId;
        orderNumber?: string;
        phoneHash?: string;
        status?: string;
        dispatch?: {
          assignedDriverId?: mongoose.Types.ObjectId | null;
          assignedAt?: Date | null;
        };
      } | null>();

    if (!updated) {
      const existing = await Order.findById(orderObjectId)
        .select(
          "_id cityId deliverySnapshot.mode status dispatch.assignedDriverId dispatch.currentOfferDriverId dispatch.offerExpiresAt"
        )
        .lean<{
          _id: mongoose.Types.ObjectId;
          cityId?: mongoose.Types.ObjectId | null;
          deliverySnapshot?: { mode?: string | null };
          status?: string;
          dispatch?: {
            assignedDriverId?: mongoose.Types.ObjectId | null;
            currentOfferDriverId?: mongoose.Types.ObjectId | null;
            offerExpiresAt?: Date | null;
          };
        } | null>();

      if (!existing || String(existing.cityId || "") !== String(city._id)) {
        return fail("NOT_FOUND", "Order not found in selected city.", 404);
      }
      if (String(existing.deliverySnapshot?.mode || "") !== "platform_driver") {
        return fail("INVALID_DELIVERY_MODEL", "Only platform-driver orders can be accepted.", 409);
      }
      if (String(existing.dispatch?.assignedDriverId || "") === String(driver._id)) {
        return ok({
          orderId: String(existing._id),
          driverId: String(driver._id),
          accepted: true,
          idempotent: true,
          status: String(existing.status || ""),
        });
      }
      if (existing.dispatch?.assignedDriverId) {
        return fail("ORDER_ALREADY_ASSIGNED", "Order already assigned.", 409);
      }
      if (String(existing.dispatch?.currentOfferDriverId || "") !== String(driver._id)) {
        return fail("ORDER_NOT_AVAILABLE", "This order is no longer available.", 409);
      }
      if (!existing.dispatch?.offerExpiresAt || new Date(existing.dispatch.offerExpiresAt).getTime() <= now.getTime()) {
        return fail("OFFER_EXPIRED", "This order offer expired.", 409);
      }
      return fail("STATUS_NOT_ALLOWED", "Order cannot be accepted in its current status.", 409);
    }

    await Driver.updateOne(
      { _id: driverIdObj, cityId: cityIdObj },
      {
        $set: {
          availability: "busy",
          breakStartedAt: null,
          breakReason: null,
          breakNote: "",
          lastAssignedAt: now,
          lastSeenAt: now,
        },
      }
    );

    await DispatchAudit.create({
      cityId: cityIdObj,
      orderId: updated._id,
      businessId: updated.businessId,
      driverId: driverIdObj,
      action: "DRIVER_ASSIGNED",
      actor: "driver",
      meta: {
        cityId: cityIdObj,
        driverId: driverIdObj,
        selectedDriverId: driverIdObj,
        driverName,
        note: "driver_offer_accept",
        previousDriverId: null,
        newDriverId: driverIdObj,
      },
    });

    await settleNotificationWrites(
      "driver.orders.accept",
      [
        queueDriverAssignedNotifications({
          orderId: updated._id,
          orderNumber: updated.orderNumber || null,
          businessId: updated.businessId,
          cityId: cityIdObj,
          driverId: driverIdObj,
          customerPhoneHash: String(updated.phoneHash || "").trim() || null,
          deliveryMode: "platform_driver",
          source: "driver.orders.accept",
        }),
      ],
      {
        orderId: String(updated._id),
        driverId: String(driverIdObj),
      }
    );

    return ok({
      orderId: String(updated._id),
      orderNumber: String(updated.orderNumber || ""),
      driverId: String(driver._id),
      assignedDriverId: String(driver._id),
      accepted: true,
      status: String(updated.status || ""),
      assignedAt: updated.dispatch?.assignedAt || now,
    });
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not accept driver order.",
      err.status || 500
    );
  }
}
