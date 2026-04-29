import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { ok, fail, readJson } from "@/lib/apiResponse";
import { requireAdminKey } from "@/lib/adminAuth";
import { resolveOperationalOrderDeliveryMode } from "@/lib/deliveryPolicy";
import { buildDispatchAssignmentSet } from "@/lib/driverDispatchOffers";
import {
  queueDriverAssignedNotifications,
  settleNotificationWrites,
} from "@/lib/notificationEvents";
import { isFinalStatus, isOrderStatus } from "@/lib/orderStatus";
import { getWeekKey } from "@/lib/geo";
import { Business } from "@/models/Business";
import { Driver } from "@/models/Driver";
import { DispatchAudit } from "@/models/DispatchAudit";
import { OpsEvent } from "@/models/OpsEvent";
import { Order } from "@/models/Order";

type ApiError = Error & { status?: number; code?: string };

type AssignBody = {
  orderId?: string;
  driverId?: string;
  confirm?: string;
};

type OrderLean = {
  _id: mongoose.Types.ObjectId;
  businessId: mongoose.Types.ObjectId;
  businessName?: string;
  orderNumber?: string;
  phoneHash?: string;
  cityId?: mongoose.Types.ObjectId | null;
  status?: string;
  deliverySnapshot?: {
    mode?: string | null;
  } | null;
  dispatch?: {
    assignedDriverId?: mongoose.Types.ObjectId | null;
  } | null;
  merchantDelivery?: {
    assignedAt?: Date | null;
    riderName?: string | null;
    riderPhone?: string | null;
  } | null;
};

export async function POST(req: Request) {
  try {
    requireAdminKey(req);
    const body = await readJson<AssignBody>(req);
    const orderId = String(body.orderId || "").trim();
    const driverId = String(body.driverId || "").trim();
    const confirm = String(body.confirm || "").trim();

    if (!mongoose.Types.ObjectId.isValid(orderId) || !mongoose.Types.ObjectId.isValid(driverId)) {
      return fail("VALIDATION_ERROR", "Valid orderId and driverId are required.", 400);
    }
    if (confirm !== "ASSIGN") {
      return fail("VALIDATION_ERROR", "confirm must be ASSIGN.", 400);
    }

    await dbConnect();
    const [order, driver] = await Promise.all([
      Order.findById(orderId)
        .select("_id businessId businessName orderNumber phoneHash cityId status deliverySnapshot.mode dispatch.assignedDriverId merchantDelivery.assignedAt merchantDelivery.riderName merchantDelivery.riderPhone")
        .lean<OrderLean | null>(),
      Driver.findById(driverId).select("_id name isActive").lean<{
        _id: mongoose.Types.ObjectId;
        name: string;
        isActive: boolean;
      } | null>(),
    ]);
    if (!order) return fail("NOT_FOUND", "Order not found.", 404);
    if (!driver || !driver.isActive) return fail("NOT_FOUND", "Driver not available.", 404);

    const status = String(order.status || "").trim();
    if (!isOrderStatus(status) || isFinalStatus(status)) {
      return fail("INVALID_STATE", "Order is in a final state.", 409);
    }

    const business = await Business.findById(order.businessId)
      .select("_id isActive deliveryType")
      .lean<{ _id: mongoose.Types.ObjectId; isActive?: boolean; deliveryType?: string | null } | null>();
    if (!business || !business.isActive) {
      return fail("BUSINESS_NOT_AVAILABLE", "Business is not active.", 409);
    }

    const now = new Date();
    const updated = await Order.findByIdAndUpdate(
      order._id,
      {
        $set: {
          ...buildDispatchAssignmentSet({
            driverId: driver._id,
            driverName: String(driver.name || "").trim() || null,
            assignedAt: now,
            dispatchStatus: "driver_assigned",
          }),
        },
      },
      { returnDocument: "after" }
    ).lean<{
      _id: mongoose.Types.ObjectId;
      orderNumber?: string;
      dispatch?: {
        assignedDriverId?: mongoose.Types.ObjectId | null;
        assignedDriverName?: string | null;
        assignedAt?: Date | null;
      };
    } | null>();
    if (!updated) return fail("NOT_FOUND", "Order not found.", 404);

    const audit = await DispatchAudit.create({
      orderId: order._id,
      businessId: order.businessId,
      action: "ASSIGN_DRIVER",
      actor: "admin",
      meta: {
        driverId: driver._id,
        driverName: String(driver.name || "").trim() || null,
      },
    });
    try {
      await OpsEvent.create({
        type: "DISPATCH_ASSIGN",
        severity: "low",
        weekKey: getWeekKey(now),
        businessId: order.businessId,
        businessName: String(order.businessName || ""),
        meta: {
          orderId: String(order._id),
          driverId: String(driver._id),
        },
      });
    } catch {
      // no-op: dispatch assignment should not fail on event write
    }

    const deliveryMode = resolveOperationalOrderDeliveryMode(order, business);
    if (deliveryMode === "platform_driver") {
      await settleNotificationWrites(
        "admin.dispatch.assign",
        [
          queueDriverAssignedNotifications({
            orderId: updated._id,
            orderNumber: order.orderNumber || null,
            businessId: order.businessId,
            cityId: order.cityId || null,
            driverId: driver._id,
            customerPhoneHash: String(order.phoneHash || "").trim() || null,
            deliveryMode,
            source: "admin.dispatch.assign",
          }),
        ],
        {
          orderId: String(updated._id),
          driverId: String(driver._id),
        }
      );
    }

    return ok({
      orderId: String(updated._id),
      orderNumber: String(updated.orderNumber || ""),
      dispatch: {
        assignedDriverId: updated.dispatch?.assignedDriverId
          ? String(updated.dispatch.assignedDriverId)
          : null,
        assignedDriverName: updated.dispatch?.assignedDriverName || null,
        assignedAt: updated.dispatch?.assignedAt || null,
      },
      auditId: String(audit._id),
    });
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not assign driver.",
      err.status || 500
    );
  }
}
