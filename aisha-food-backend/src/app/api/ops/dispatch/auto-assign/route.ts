import mongoose from "mongoose";
import { ok, fail, readJson } from "@/lib/apiResponse";
import { requireAdminKey } from "@/lib/adminAuth";
import {
  ensurePlatformDispatchOrder,
  sanitizeDispatchNote,
  sameObjectId,
  resolveDispatchSelectedCity,
} from "@/lib/dispatchControl";
import { DISPATCH_ASSIGNABLE_STATUSES, isDispatchAssignableStatus } from "@/lib/dispatch";
import { buildDispatchAssignmentSet } from "@/lib/driverDispatchOffers";
import { assertNotInMaintenance } from "@/lib/maintenance";
import { dbConnect } from "@/lib/mongodb";
import {
  queueDriverAssignedNotifications,
  settleNotificationWrites,
} from "@/lib/notificationEvents";
import { estimateDispatchEtaMinutes, pickBestDriverForOrder } from "@/lib/smartDispatch";
import { Business } from "@/models/Business";
import { DispatchAudit } from "@/models/DispatchAudit";
import { Driver } from "@/models/Driver";
import { Order } from "@/models/Order";

type ApiError = Error & { status?: number; code?: string };

type AutoAssignBody = {
  cityId?: string;
  orderId?: string;
  note?: string;
};

type DispatchableOrder = {
  _id: mongoose.Types.ObjectId;
  cityId?: mongoose.Types.ObjectId | null;
  businessId?: mongoose.Types.ObjectId | null;
  businessName?: string;
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

async function writeDispatchAuditSafe(payload: Record<string, unknown>) {
  try {
    await DispatchAudit.create(payload);
  } catch (error) {
    console.error("dispatch auto-assign audit failed", error);
  }
}

export async function POST(req: Request) {
  try {
    requireAdminKey(req);
    await assertNotInMaintenance();

    const body = await readJson<AutoAssignBody>(req);
    const orderId = String(body.orderId || "").trim();
    const note = sanitizeDispatchNote(body.note);

    if (!mongoose.Types.ObjectId.isValid(orderId)) {
      return fail("VALIDATION_ERROR", "Valid orderId is required.", 400);
    }

    const selectedCity = await resolveDispatchSelectedCity(req, body.cityId);
    await dbConnect();

    const cityObjectId = new mongoose.Types.ObjectId(String(selectedCity._id));
    const orderObjectId = new mongoose.Types.ObjectId(orderId);

    const order = await Order.findOne({
      _id: orderObjectId,
      cityId: cityObjectId,
      status: { $in: DISPATCH_ASSIGNABLE_STATUSES },
    })
      .select("_id cityId businessId businessName orderNumber phoneHash status deliverySnapshot.mode dispatch.assignedDriverId merchantDelivery.assignedAt merchantDelivery.riderName merchantDelivery.riderPhone")
      .lean<DispatchableOrder | null>();

    if (!order) {
      return fail("NOT_FOUND", "Order not found in selected city.", 404);
    }
    const business =
      order.businessId && mongoose.Types.ObjectId.isValid(String(order.businessId))
        ? await Business.findById(order.businessId)
            .select("_id deliveryType")
            .lean<{ _id: mongoose.Types.ObjectId; deliveryType?: string | null } | null>()
        : null;
    ensurePlatformDispatchOrder(order, business);

    const { bestDriver, ranked } = await pickBestDriverForOrder({
      cityId: cityObjectId,
      order: {
        _id: order._id,
        businessId: order.businessId || null,
      },
    });

    if (!bestDriver) {
      return ok({
        orderId: String(order._id),
        cityId: String(cityObjectId),
        assigned: false,
        reason: "NO_AVAILABLE_DRIVER",
        ranked: [],
      });
    }

    const selectedRank = ranked.find((row) => row.driverId === String(bestDriver._id)) || null;
    const etaMinutes = estimateDispatchEtaMinutes({
      activeLoad: Number(selectedRank?.activeLoad || 0),
      sameZone: Boolean(selectedRank?.sameZone),
    });
    const rankedTop5 = ranked.slice(0, 5);
    const currentDriverId = order.dispatch?.assignedDriverId || null;

    if (sameObjectId(currentDriverId, bestDriver._id)) {
      await writeDispatchAuditSafe({
        cityId: cityObjectId,
        orderId: orderObjectId,
        businessId: order.businessId || null,
        driverId: bestDriver._id,
        action: "AUTO_ASSIGN_SKIPPED",
        actor: "ops",
        meta: {
          cityId: cityObjectId,
          previousDriverId: currentDriverId,
          selectedDriverId: bestDriver._id,
          reason: "ALREADY_ASSIGNED_TO_BEST_DRIVER",
          etaMinutes,
          score: selectedRank?.score ?? null,
          rankedTop5,
          note: note || null,
        },
      });

      return ok({
        orderId: String(order._id),
        cityId: String(cityObjectId),
        driverId: String(bestDriver._id),
        assigned: false,
        idempotent: true,
        reason: "ALREADY_ASSIGNED_TO_BEST_DRIVER",
      });
    }

    const now = new Date();
    const orderFilter: Record<string, unknown> = {
      _id: orderObjectId,
      cityId: cityObjectId,
      status: { $in: DISPATCH_ASSIGNABLE_STATUSES },
      "dispatch.assignedDriverId": currentDriverId || null,
    };

    const updatedOrder = await Order.findOneAndUpdate(
      orderFilter,
      {
        $set: {
          ...buildDispatchAssignmentSet({
            driverId: bestDriver._id,
            driverName: String(bestDriver.name || "").trim() || null,
            assignedAt: now,
            dispatchStatus: "driver_assigned",
          }),
        },
      },
      { new: true }
    )
      .select("_id businessId dispatch.assignedDriverId")
      .lean<{
        _id: mongoose.Types.ObjectId;
        businessId?: mongoose.Types.ObjectId | null;
        dispatch?: { assignedDriverId?: mongoose.Types.ObjectId | null };
      } | null>();

    if (!updatedOrder) {
      const refreshed = await Order.findById(orderObjectId)
        .select("_id cityId businessId status deliverySnapshot.mode dispatch.assignedDriverId merchantDelivery.assignedAt merchantDelivery.riderName merchantDelivery.riderPhone")
        .lean<DispatchableOrder | null>();

      if (!refreshed || !sameObjectId(refreshed.cityId, cityObjectId)) {
        return fail("NOT_FOUND", "Order not found in selected city.", 404);
      }
      ensurePlatformDispatchOrder(refreshed, business);

      if (!isDispatchAssignableStatus(String(refreshed.status || ""))) {
        return fail("INVALID_STATE", "Order is no longer dispatchable.", 409);
      }

      if (sameObjectId(refreshed.dispatch?.assignedDriverId, bestDriver._id)) {
        await writeDispatchAuditSafe({
          cityId: cityObjectId,
          orderId: orderObjectId,
          businessId: refreshed.businessId || null,
          driverId: bestDriver._id,
          action: "AUTO_ASSIGN_SKIPPED",
          actor: "ops",
          meta: {
            cityId: cityObjectId,
            previousDriverId: refreshed.dispatch?.assignedDriverId || null,
            selectedDriverId: bestDriver._id,
            reason: "ALREADY_ASSIGNED_TO_BEST_DRIVER",
            etaMinutes,
            score: selectedRank?.score ?? null,
            rankedTop5,
            note: note || null,
          },
        });

        return ok({
          orderId: String(refreshed._id),
          cityId: String(cityObjectId),
          driverId: String(bestDriver._id),
          assigned: false,
          idempotent: true,
          reason: "ALREADY_ASSIGNED_TO_BEST_DRIVER",
        });
      }

      return fail("INVALID_STATE", "Could not auto-assign order.", 409);
    }

    await Driver.updateOne(
      {
        _id: bestDriver._id,
        cityId: cityObjectId,
      },
      {
        $set: {
          lastAssignedAt: now,
        },
      }
    );

    const action = currentDriverId ? "AUTO_DRIVER_REASSIGNED" : "AUTO_DRIVER_ASSIGNED";

    await writeDispatchAuditSafe({
      cityId: cityObjectId,
      orderId: orderObjectId,
      businessId: order.businessId || null,
      driverId: bestDriver._id,
      action,
      actor: "ops",
      meta: {
        cityId: cityObjectId,
        previousDriverId: currentDriverId,
        selectedDriverId: bestDriver._id,
        etaMinutes,
        score: selectedRank?.score ?? null,
        rankedTop5,
        note: note || null,
        reason: currentDriverId ? "AUTO_REASSIGN" : "AUTO_ASSIGN",
      },
    });

    await settleNotificationWrites(
      "ops.dispatch.auto_assign",
      [
        queueDriverAssignedNotifications({
          orderId: updatedOrder._id,
          orderNumber: order.orderNumber || null,
          businessId: order.businessId || null,
          cityId: cityObjectId,
          driverId: bestDriver._id,
          customerPhoneHash: String(order.phoneHash || "").trim() || null,
          deliveryMode: "platform_driver",
          source: "ops.dispatch.auto_assign",
          meta: {
            etaMinutes,
            score: selectedRank?.score ?? null,
          },
        }),
      ],
      {
        orderId: String(updatedOrder._id),
        driverId: String(bestDriver._id),
      }
    );

    return ok({
      orderId: String(updatedOrder._id),
      cityId: String(cityObjectId),
      driverId: String(bestDriver._id),
      assigned: true,
      etaMinutes,
      score: Number(selectedRank?.score || 0),
      rankedTop3: ranked.slice(0, 3),
    });
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not auto-assign order.",
      err.status || 500
    );
  }
}
