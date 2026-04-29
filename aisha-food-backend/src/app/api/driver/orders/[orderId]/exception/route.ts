import mongoose from "mongoose";
import { fail, ok, readJson } from "@/lib/apiResponse";
import { requireDriverCityContext } from "@/lib/driverContext";
import { assertNotInMaintenance } from "@/lib/maintenance";
import { dbConnect } from "@/lib/mongodb";
import {
  queueDeliveryExceptionNotifications,
  settleNotificationWrites,
} from "@/lib/notificationEvents";
import { DispatchAudit } from "@/models/DispatchAudit";
import { DriverAudit } from "@/models/DriverAudit";
import { Order } from "@/models/Order";

type ApiError = Error & { status?: number; code?: string };

type ExceptionReason =
  | "customer_unreachable"
  | "address_issue"
  | "vehicle_issue"
  | "merchant_delay"
  | "safety_issue"
  | "other";

type ExceptionBody = {
  reason?: string;
  note?: string;
};

const EXCEPTION_REASONS = new Set<ExceptionReason>([
  "customer_unreachable",
  "address_issue",
  "vehicle_issue",
  "merchant_delay",
  "safety_issue",
  "other",
]);

const FINAL_STATUSES = new Set(["delivered", "cancelled"]);

function normalizeReason(value: unknown): ExceptionReason | null {
  const reason = String(value || "").trim().toLowerCase();
  return EXCEPTION_REASONS.has(reason as ExceptionReason) ? (reason as ExceptionReason) : null;
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

    const body = await readJson<ExceptionBody>(req);
    const reason = normalizeReason(body.reason);
    const note = String(body.note || "").trim().slice(0, 280);
    const auditNote = note.slice(0, 200);
    if (!reason) {
      return fail("VALIDATION_ERROR", "reason must be a valid delivery exception reason.", 400);
    }

    const cityId = new mongoose.Types.ObjectId(String(city._id));
    const driverId = new mongoose.Types.ObjectId(String(driver._id));
    const orderObjectId = new mongoose.Types.ObjectId(orderId);
    const order = await Order.findOne({
      _id: orderObjectId,
      cityId,
      "deliverySnapshot.mode": "platform_driver",
    })
      .select("_id businessId orderNumber phoneHash status dispatch.assignedDriverId deliveryException.status")
      .lean<{
        _id: mongoose.Types.ObjectId;
        businessId: mongoose.Types.ObjectId;
        orderNumber?: string;
        phoneHash?: string;
        status?: string;
        dispatch?: { assignedDriverId?: mongoose.Types.ObjectId | null };
        deliveryException?: { status?: string | null };
      } | null>();

    if (!order) {
      return fail("NOT_FOUND", "Platform-driver order not found.", 404);
    }

    const assignedDriverId = String(order.dispatch?.assignedDriverId || "");
    if (assignedDriverId !== String(driver._id)) {
      return fail("FORBIDDEN", "Only the assigned driver can report a delivery exception.", 403);
    }

    if (FINAL_STATUSES.has(String(order.status || ""))) {
      return fail("ORDER_FINALIZED", "Finalized orders cannot receive delivery exceptions.", 409);
    }

    const now = new Date();
    const deliveryException = {
      reason,
      note,
      reportedAt: now,
      reportedByDriverId: driverId,
      status: "open",
    };

    const updateResult = await Order.updateOne(
      {
        _id: order._id,
        cityId,
        "deliverySnapshot.mode": "platform_driver",
        "dispatch.assignedDriverId": driverId,
        status: { $nin: Array.from(FINAL_STATUSES) },
      },
      {
        $set: {
          deliveryException,
        },
      }
    );
    if (!updateResult.matchedCount) {
      return fail("STALE_ORDER_STATE", "Order state changed before the exception could be saved.", 409);
    }

    await Promise.all([
      DriverAudit.create({
        cityId,
        driverId,
        orderId: order._id,
        action: "DELIVERY_EXCEPTION_REPORTED",
        meta: {
          reason,
          note,
        },
      }),
      DispatchAudit.create({
        cityId,
        orderId: order._id,
        businessId: order.businessId,
        driverId,
        action: "DELIVERY_EXCEPTION_REPORTED",
        actor: "driver",
        meta: {
          driverId,
          selectedDriverId: driverId,
          cityId,
          reason,
          note: auditNote,
        },
      }),
    ]);

    await settleNotificationWrites(
      "driver.orders.exception",
      [
        queueDeliveryExceptionNotifications({
          orderId: order._id,
          orderNumber: order.orderNumber || null,
          businessId: order.businessId,
          cityId,
          driverId,
          customerPhoneHash: String(order.phoneHash || "").trim() || null,
          deliveryMode: "platform_driver",
          source: "driver.orders.exception",
          reason,
        }),
      ],
      {
        orderId: String(order._id),
        driverId: String(driverId),
        reason,
      }
    );

    return ok({
      orderId: String(order._id),
      deliveryException: {
        reason,
        note: note || null,
        reportedAt: now,
        reportedByDriverId: String(driver._id),
        status: "open",
      },
    });
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not report delivery exception.",
      err.status || 500
    );
  }
}
