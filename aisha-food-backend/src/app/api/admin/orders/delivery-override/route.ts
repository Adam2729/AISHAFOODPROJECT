import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { ok, fail, readJson } from "@/lib/apiResponse";
import { requireAdminKey } from "@/lib/adminAuth";
import { getWeekKey } from "@/lib/geo";
import { canTransition, isOrderStatus } from "@/lib/orderStatus";
import { BusinessAudit } from "@/models/BusinessAudit";
import { OpsEvent } from "@/models/OpsEvent";
import { Order } from "@/models/Order";
import { Settlement } from "@/models/Settlement";
import { SettlementAudit } from "@/models/SettlementAudit";

type ApiError = Error & { status?: number; code?: string };

type DeliveryOverrideBody = {
  orderId?: string;
  confirm?: string;
  note?: string;
  resolvedBy?: string;
};

type OrderLean = {
  _id: mongoose.Types.ObjectId;
  cityId?: mongoose.Types.ObjectId | null;
  orderNumber: string;
  businessId: mongoose.Types.ObjectId;
  businessName: string;
  status: string;
  createdAt: Date;
  subtotal?: number;
  commissionAmount?: number;
  settlement?: {
    counted?: boolean;
  } | null;
  deliveryProof?: {
    verifiedAt?: Date | null;
    verifiedBy?: "customer_code" | "admin_override" | null;
  } | null;
  sla?: {
    firstActionAt?: Date | null;
    deliveredAt?: Date | null;
  } | null;
};

export async function POST(req: Request) {
  try {
    requireAdminKey(req);
    const body = await readJson<DeliveryOverrideBody>(req);
    const orderId = String(body.orderId || "").trim();
    const confirm = String(body.confirm || "").trim();
    const note = String(body.note || "").trim().slice(0, 500);
    const resolvedBy = String(body.resolvedBy || "").trim().slice(0, 60);

    if (!mongoose.Types.ObjectId.isValid(orderId)) {
      return fail("VALIDATION_ERROR", "Valid orderId is required.", 400);
    }
    if (confirm !== "OVERRIDE") {
      return fail("VALIDATION_ERROR", "confirm must be OVERRIDE.", 400);
    }
    if (!resolvedBy) {
      return fail("VALIDATION_ERROR", "resolvedBy is required.", 400);
    }
    if (!note) {
      return fail("VALIDATION_ERROR", "note is required.", 400);
    }

    await dbConnect();
    const existing = await Order.findById(orderId)
      .select(
        "_id cityId orderNumber businessId businessName status createdAt subtotal commissionAmount settlement.counted deliveryProof.verifiedAt deliveryProof.verifiedBy sla.firstActionAt sla.deliveredAt"
      )
      .lean<OrderLean | null>();
    if (!existing) return fail("NOT_FOUND", "Order not found.", 404);

    if (!isOrderStatus(existing.status)) {
      return fail("INVALID_STATE", "Order has invalid status.", 409);
    }

    const now = new Date();
    const shouldTransitionToDelivered = existing.status !== "delivered";
    if (shouldTransitionToDelivered && !canTransition(existing.status, "delivered")) {
      return fail(
        "INVALID_TRANSITION",
        `Cannot move from ${existing.status} to delivered.`,
        409
      );
    }

    const weekKey = getWeekKey(new Date(existing.createdAt));

    if (shouldTransitionToDelivered) {
      const lockedSettlement = await Settlement.findOne({
        businessId: existing.businessId,
        weekKey,
        status: "locked",
      })
        .select("_id")
        .lean();
      if (lockedSettlement) {
        return fail("SETTLEMENT_LOCKED", "Settlement is locked and cannot be modified.", 409);
      }
    }

    const createdAtMs = new Date(existing.createdAt).getTime();
    const totalMinutes = Math.max(0, Math.round((Date.now() - createdAtMs) / 60000));
    const updateSet: Record<string, unknown> = {
      "deliveryProof.verifiedAt": now,
      "deliveryProof.verifiedBy": "admin_override",
    };
    if (shouldTransitionToDelivered) {
      updateSet.status = "delivered";
      updateSet["settlement.weekKey"] = weekKey;
      updateSet["settlement.status"] = "pending";
      updateSet["settlement.counted"] = true;
      if (!existing.sla?.firstActionAt) {
        updateSet["sla.firstActionAt"] = now;
        updateSet["sla.firstActionMinutes"] = totalMinutes;
      }
      if (!existing.sla?.deliveredAt) {
        updateSet["sla.deliveredAt"] = now;
        updateSet["sla.totalMinutes"] = totalMinutes;
      }
    }

    const updateQuery: Record<string, unknown> = {
      _id: existing._id,
      businessId: existing.businessId,
    };
    if (shouldTransitionToDelivered) {
      updateQuery.status = existing.status;
      updateQuery["settlement.counted"] = false;
    }

    const updated = await Order.findOneAndUpdate(
      updateQuery,
      { $set: updateSet },
      { returnDocument: "after" }
    ).lean<OrderLean | null>();

    const latest =
      updated ||
      (await Order.findById(existing._id)
        .select(
          "_id cityId orderNumber businessId businessName status createdAt subtotal commissionAmount settlement.counted settlement.weekKey deliveryProof.verifiedAt deliveryProof.verifiedBy sla.firstActionAt sla.deliveredAt"
        )
        .lean<OrderLean | null>());

    if (!latest) return fail("NOT_FOUND", "Order not found.", 404);

    const transitioned = shouldTransitionToDelivered && Boolean(updated);

    if (transitioned) {
      await Settlement.findOneAndUpdate(
        {
          businessId: existing.businessId,
          weekKey,
          status: { $ne: "locked" },
        },
        {
          $setOnInsert: {
            cityId: existing.cityId || null,
            businessId: existing.businessId,
            businessName: existing.businessName,
            weekKey,
            status: "pending",
          },
          $inc: {
            ordersCount: 1,
            grossSubtotal: Number(existing.subtotal || 0),
            feeTotal: Number(existing.commissionAmount || 0),
          },
        },
        { upsert: true, returnDocument: "after" }
      );

      await SettlementAudit.create({
        businessId: existing.businessId,
        weekKey,
        action: "ORDER_COUNTED",
        orderId: existing._id,
        amount: Number(existing.commissionAmount || 0),
        meta: {
          subtotal: Number(existing.subtotal || 0),
          override: true,
          resolvedBy,
          note,
        },
      }).catch(() => null);
    }

    await BusinessAudit.create({
      businessId: existing.businessId,
      action: "DELIVERY_OVERRIDE",
      meta: {
        orderId: String(existing._id),
        orderNumber: String(existing.orderNumber || ""),
        resolvedBy,
        note,
        transitioned,
      },
    }).catch(() => null);

    await OpsEvent.create({
      type: "DELIVERY_OVERRIDE",
      severity: "medium",
      weekKey: getWeekKey(now),
      businessId: existing.businessId,
      businessName: String(existing.businessName || ""),
      meta: {
        orderId: String(existing._id),
        orderNumber: String(existing.orderNumber || ""),
        note,
        resolvedBy,
        transitioned,
      },
    }).catch(() => null);

    return ok({
      order: latest,
      transitioned,
    });
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not override delivery proof.",
      err.status || 500
    );
  }
}
