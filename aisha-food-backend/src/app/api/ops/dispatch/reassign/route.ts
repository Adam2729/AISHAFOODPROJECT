import mongoose from "mongoose";
import { ok, fail, readJson } from "@/lib/apiResponse";
import { requireAdminKey } from "@/lib/adminAuth";
import {
  ensureDispatchableOrderStatus,
  ensurePlatformDispatchOrder,
  resolveDispatchSelectedCity,
  sameObjectId,
  sanitizeDispatchNote,
} from "@/lib/dispatchControl";
import { buildDispatchAssignmentSet } from "@/lib/driverDispatchOffers";
import { assertNotInMaintenance } from "@/lib/maintenance";
import { dbConnect } from "@/lib/mongodb";
import {
  queueDriverAssignedNotifications,
  settleNotificationWrites,
} from "@/lib/notificationEvents";
import { Business } from "@/models/Business";
import { DispatchAudit } from "@/models/DispatchAudit";
import { Driver } from "@/models/Driver";
import { Order } from "@/models/Order";

type ApiError = Error & { status?: number; code?: string };

type ReassignBody = {
  cityId?: string;
  orderId?: string;
  driverId?: string;
  note?: string;
};

type DispatchOrder = {
  _id: mongoose.Types.ObjectId;
  cityId?: mongoose.Types.ObjectId | null;
  businessId: mongoose.Types.ObjectId;
  orderNumber?: string;
  phoneHash?: string;
  status?: string;
  deliverySnapshot?: {
    mode?: string | null;
  };
  dispatch?: {
    assignedDriverId?: mongoose.Types.ObjectId | null;
  };
  merchantDelivery?: {
    assignedAt?: Date | null;
    riderName?: string | null;
    riderPhone?: string | null;
  };
};

type DispatchDriver = {
  _id: mongoose.Types.ObjectId;
  cityId?: mongoose.Types.ObjectId | null;
  name?: string;
  isActive?: boolean;
  isBanned?: boolean;
};

export async function POST(req: Request) {
  try {
    requireAdminKey(req);
    await assertNotInMaintenance();

    const body = await readJson<ReassignBody>(req);
    const orderId = String(body.orderId || "").trim();
    const driverId = String(body.driverId || "").trim();
    const note = sanitizeDispatchNote(body.note);

    if (!mongoose.Types.ObjectId.isValid(orderId) || !mongoose.Types.ObjectId.isValid(driverId)) {
      return fail("VALIDATION_ERROR", "Valid orderId and driverId are required.", 400);
    }

    const selectedCity = await resolveDispatchSelectedCity(req, body.cityId);
    await dbConnect();

    const orderObjectId = new mongoose.Types.ObjectId(orderId);
    const driverObjectId = new mongoose.Types.ObjectId(driverId);
    const cityObjectId = new mongoose.Types.ObjectId(String(selectedCity._id));

    const [order, driver] = await Promise.all([
      Order.findById(orderObjectId)
        .select("_id cityId businessId orderNumber phoneHash status deliverySnapshot.mode dispatch.assignedDriverId merchantDelivery.assignedAt merchantDelivery.riderName merchantDelivery.riderPhone")
        .lean<DispatchOrder | null>(),
      Driver.findById(driverObjectId)
        .select("_id cityId name isActive isBanned")
        .lean<DispatchDriver | null>(),
    ]);

    if (!order || !sameObjectId(order.cityId, selectedCity._id)) {
      return fail("NOT_FOUND", "Order not found in selected city.", 404);
    }
    if (!driver || !sameObjectId(driver.cityId, selectedCity._id)) {
      return fail("NOT_FOUND", "Driver not found in selected city.", 404);
    }
    if (!driver.isActive || driver.isBanned) {
      return fail("DRIVER_NOT_AVAILABLE", "Driver is not available for dispatch.", 409);
    }
    const business = await Business.findById(order.businessId)
      .select("_id deliveryType")
      .lean<{ _id: mongoose.Types.ObjectId; deliveryType?: string | null } | null>();
    ensurePlatformDispatchOrder(order, business);

    ensureDispatchableOrderStatus(order.status);

    const previousDriverId = order.dispatch?.assignedDriverId || null;
    if (!previousDriverId) {
      return fail("INVALID_STATE", "Order does not currently have an assigned driver.", 409);
    }
    if (sameObjectId(previousDriverId, driver._id)) {
      return ok({
        orderId: String(order._id),
        driverId: String(driver._id),
        idempotent: true,
      });
    }

    const now = new Date();
    const driverName = String(driver.name || "").trim() || null;

    const updated = await Order.findOneAndUpdate(
      {
        _id: orderObjectId,
        cityId: cityObjectId,
        status: { $in: ["accepted", "preparing", "ready", "out_for_delivery"] },
        "dispatch.assignedDriverId": previousDriverId,
      },
      {
        $set: {
          ...buildDispatchAssignmentSet({
            driverId: driverObjectId,
            driverName,
            assignedAt: now,
            dispatchStatus: "driver_assigned",
          }),
        },
      },
      { new: true }
    )
      .select("_id dispatch.assignedDriverId")
      .lean<{
        _id: mongoose.Types.ObjectId;
        dispatch?: { assignedDriverId?: mongoose.Types.ObjectId | null };
      } | null>();

    if (!updated) {
      const refreshed = await Order.findById(orderObjectId)
        .select("_id cityId businessId status deliverySnapshot.mode dispatch.assignedDriverId merchantDelivery.assignedAt merchantDelivery.riderName merchantDelivery.riderPhone")
        .lean<DispatchOrder | null>();
      if (!refreshed || !sameObjectId(refreshed.cityId, selectedCity._id)) {
        return fail("NOT_FOUND", "Order not found in selected city.", 404);
      }
      ensurePlatformDispatchOrder(refreshed, business);
      ensureDispatchableOrderStatus(refreshed.status);
      if (sameObjectId(refreshed.dispatch?.assignedDriverId, driver._id)) {
        return ok({
          orderId: String(refreshed._id),
          driverId: String(driver._id),
          idempotent: true,
        });
      }
      if (!refreshed.dispatch?.assignedDriverId) {
        return fail("INVALID_STATE", "Order no longer has an assigned driver.", 409);
      }
      return fail("INVALID_STATE", "Could not reassign driver.", 409);
    }

    await Driver.updateOne(
      {
        _id: driverObjectId,
        cityId: cityObjectId,
      },
      {
        $set: {
          lastAssignedAt: now,
        },
      }
    );

    await DispatchAudit.create({
      cityId: cityObjectId,
      orderId: orderObjectId,
      businessId: order.businessId,
      driverId: driverObjectId,
      action: "DRIVER_REASSIGNED",
      actor: "ops",
      meta: {
        cityId: cityObjectId,
        driverId: driverObjectId,
        driverName,
        note: note || null,
        previousDriverId,
        newDriverId: driverObjectId,
      },
    });

    await settleNotificationWrites(
      "ops.dispatch.reassign",
      [
        queueDriverAssignedNotifications({
          orderId: updated._id,
          orderNumber: order.orderNumber || null,
          businessId: order.businessId,
          cityId: cityObjectId,
          driverId: driverObjectId,
          customerPhoneHash: String(order.phoneHash || "").trim() || null,
          deliveryMode: "platform_driver",
          source: "ops.dispatch.reassign",
        }),
      ],
      {
        orderId: String(updated._id),
        driverId: String(driverObjectId),
      }
    );

    return ok({
      orderId: String(updated._id),
      previousDriverId: String(previousDriverId),
      driverId: String(driver._id),
      reassigned: true,
    });
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not reassign driver.",
      err.status || 500
    );
  }
}
