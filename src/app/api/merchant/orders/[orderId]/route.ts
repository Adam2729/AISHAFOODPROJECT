import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { ok, fail, readJson } from "@/lib/apiResponse";
import { requireMerchantSession } from "@/lib/merchantAuth";
import { requireMerchantBusinessAvailable } from "@/lib/merchantBusiness";
import { getBoolSetting, getNumberSetting } from "@/lib/appSettings";
import { Order } from "@/models/Order";
import { Settlement } from "@/models/Settlement";
import { SettlementAudit } from "@/models/SettlementAudit";
import { Business } from "@/models/Business";
import { BusinessAudit } from "@/models/BusinessAudit";
import { getWeekKey } from "@/lib/geo";
import { canTransition, isFinalStatus, isOrderStatus, type OrderStatus } from "@/lib/orderStatus";
import { logRequest } from "@/lib/logger";
import { assertNotInMaintenance } from "@/lib/maintenance";

type ApiError = Error & { status?: number; code?: string };

type PatchBody = {
  status?: string;
  cancelReason?: string;
};

type OrderLean = {
  _id: mongoose.Types.ObjectId;
  businessId: mongoose.Types.ObjectId;
  businessName: string;
  status: OrderStatus;
  createdAt: Date;
  subtotal: number;
  commissionAmount: number;
  settlement?: {
    counted?: boolean;
    collectedAt?: Date | null;
  };
};

type BusinessSlaState = {
  _id: mongoose.Types.ObjectId;
  paused?: boolean;
  health?: {
    slowAcceptCount30d?: number;
    cancelsCount30d?: number;
  };
};

async function maybeApplySlaAutoPause(
  businessId: mongoose.Types.ObjectId,
  orderId: mongoose.Types.ObjectId
) {
  try {
    const [enabled, slowAcceptThreshold, cancelThreshold, business] = await Promise.all([
      getBoolSetting("sla_auto_pause_enabled", false),
      getNumberSetting("sla_slow_accept_threshold", 10),
      getNumberSetting("sla_cancel_threshold", 10),
      Business.findById(businessId)
        .select("paused health.slowAcceptCount30d health.cancelsCount30d")
        .lean<BusinessSlaState | null>(),
    ]);

    if (!enabled || !business || business.paused) return;

    const slowAccept = Number(business.health?.slowAcceptCount30d || 0);
    const cancels = Number(business.health?.cancelsCount30d || 0);
    if (slowAccept < slowAcceptThreshold && cancels < cancelThreshold) return;

    const now = new Date();
    const pausedReason = `SLA auto-pause: slowAccept=${slowAccept} cancels=${cancels}`;
    const pauseUpdate = await Business.updateOne(
      { _id: businessId, paused: { $ne: true } },
      {
        $set: {
          paused: true,
          pausedReason,
          pausedAt: now,
        },
      }
    );

    if ((pauseUpdate.modifiedCount || 0) < 1) return;

    try {
      await BusinessAudit.create({
        businessId,
        action: "PAUSED",
        meta: {
          auto: true,
          slowAccept,
          cancels,
          thresholds: {
            slowAcceptThreshold,
            cancelThreshold,
          },
        },
      });
    } catch (auditError: unknown) {
      console.error(
        JSON.stringify({
          type: "business_audit_write_error",
          route: "merchant.orders.patch",
          action: "sla_auto_pause",
          businessId: String(businessId),
          orderId: String(orderId),
          error: auditError instanceof Error ? auditError.message : "Failed to write business audit event",
          timestamp: new Date().toISOString(),
        })
      );
    }
  } catch (error: unknown) {
    console.error(
      JSON.stringify({
        type: "sla_auto_pause_error",
        route: "merchant.orders.patch",
        businessId: String(businessId),
        orderId: String(orderId),
        error: error instanceof Error ? error.message : "Failed to evaluate SLA auto-pause",
        timestamp: new Date().toISOString(),
      })
    );
  }
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ orderId: string }> }
) {
  const startedAt = Date.now();
  const finish = (
    response: ReturnType<typeof ok> | ReturnType<typeof fail>,
    status: number,
    extra?: Record<string, unknown>
  ) => {
    logRequest(req, {
      route: "merchant.orders.patch",
      status,
      durationMs: Date.now() - startedAt,
      extra,
    });
    return response;
  };

  try {
    await assertNotInMaintenance();

    const session = requireMerchantSession(req);
    const { orderId } = await params;
    if (!mongoose.Types.ObjectId.isValid(orderId)) {
      return finish(fail("VALIDATION_ERROR", "Invalid orderId."), 400, { orderId });
    }

    const body = await readJson<PatchBody>(req);
    const requestedStatus = String(body.status || "").trim();
    const cancelReason = String(body.cancelReason || "").trim().slice(0, 280);
    if (!requestedStatus) return finish(fail("VALIDATION_ERROR", "status is required."), 400, { orderId });
    if (!isOrderStatus(requestedStatus)) return finish(fail("VALIDATION_ERROR", "Invalid status."), 400, { orderId });
    const nextStatus: OrderStatus = requestedStatus;

    await dbConnect();
    await requireMerchantBusinessAvailable(session.businessId);

    const existing = await Order.findOne({
      _id: new mongoose.Types.ObjectId(orderId),
      businessId: new mongoose.Types.ObjectId(session.businessId),
    }).lean<OrderLean | null>();
    if (!existing) return finish(fail("NOT_FOUND", "Order not found.", 404), 404, { orderId, businessId: session.businessId });

    if (!isOrderStatus(existing.status)) {
      return finish(fail("INVALID_STATE", "Order has invalid current status.", 400), 400, {
        orderId,
        businessId: session.businessId,
      });
    }
    if (isFinalStatus(existing.status)) {
      return finish(fail("INVALID_TRANSITION", "Cannot change a final order status.", 400), 400, {
        orderId,
        businessId: session.businessId,
      });
    }
    if (!canTransition(existing.status, nextStatus)) {
      return finish(fail("INVALID_TRANSITION", `Cannot move from ${existing.status} to ${nextStatus}.`, 400), 400, {
        orderId,
        businessId: session.businessId,
      });
    }

    if (nextStatus === "delivered") {
      const weekKey = getWeekKey(new Date(existing.createdAt));

      const updated = await Order.findOneAndUpdate(
        {
          _id: existing._id,
          businessId: existing.businessId,
          "settlement.counted": false,
        },
        {
          $set: {
            status: "delivered",
            "settlement.weekKey": weekKey,
            "settlement.status": "pending",
            "settlement.counted": true,
          },
        },
        { returnDocument: "after" }
      );

      if (!updated) {
        const latest = await Order.findById(existing._id).lean();
        if (latest) return finish(ok({ order: latest }), 200, { orderId, businessId: session.businessId, status: nextStatus });
        return finish(fail("NOT_FOUND", "Order not found.", 404), 404, { orderId, businessId: session.businessId });
      }

      const settlementQuery = {
        businessId: existing.businessId,
        weekKey,
      } as const;

      const settlementUpdate = {
        $setOnInsert: {
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
      };

      try {
        await Settlement.findOneAndUpdate(settlementQuery, settlementUpdate, { upsert: true, returnDocument: "after" });
      } catch (e: unknown) {
        const msg = String((e as { message?: string })?.message || "");
        const code = String((e as { code?: number | string })?.code || "");
        if (code === "11000" || /E11000/.test(msg)) {
          await Settlement.findOneAndUpdate(settlementQuery, settlementUpdate, { upsert: true, returnDocument: "after" });
        } else {
          throw e;
        }
      }

      try {
        await SettlementAudit.create({
          businessId: existing.businessId,
          weekKey,
          action: "ORDER_COUNTED",
          orderId: updated._id,
          amount: Number(existing.commissionAmount || 0),
          meta: {
            subtotal: Number(existing.subtotal || 0),
          },
        });
      } catch (auditError: unknown) {
        console.error(
          JSON.stringify({
            type: "audit_write_error",
            route: "merchant.orders.patch",
            action: "counted",
            orderId: String(existing._id),
            businessId: String(existing.businessId),
            weekKey,
            error: auditError instanceof Error ? auditError.message : "Failed to write audit event",
            timestamp: new Date().toISOString(),
          })
        );
      }

      return finish(ok({ order: updated }), 200, {
        orderId,
        businessId: session.businessId,
        status: nextStatus,
      });
    }

    const updated = await Order.findOneAndUpdate(
      {
        _id: existing._id,
        businessId: existing.businessId,
        status: existing.status,
      },
      {
        $set: {
          status: nextStatus,
          ...(nextStatus === "cancelled"
            ? { cancelReason: cancelReason || "Cancelled by merchant" }
            : {}),
        },
      },
      { returnDocument: "after" }
    );
    if (!updated) return finish(fail("CONFLICT", "Order was updated by another process. Retry.", 409), 409, {
      orderId,
      businessId: session.businessId,
    });

    if (nextStatus === "cancelled") {
      try {
        await Business.updateOne(
          { _id: existing.businessId },
          {
            $inc: { "health.cancelsCount30d": 1 },
            $set: { "health.lastHealthUpdateAt": new Date() },
          }
        );
        await maybeApplySlaAutoPause(existing.businessId, existing._id);
      } catch (healthError: unknown) {
        console.error(
          JSON.stringify({
            type: "business_health_update_error",
            route: "merchant.orders.patch",
            action: "cancelled",
            businessId: String(existing.businessId),
            orderId: String(existing._id),
            error: healthError instanceof Error ? healthError.message : "Failed to update cancel counter",
            timestamp: new Date().toISOString(),
          })
        );
      }
    }

    if ((nextStatus === "accepted" || nextStatus === "preparing") && existing.status === "new") {
      const acceptLatencyMin = (Date.now() - new Date(existing.createdAt).getTime()) / 60000;
      if (acceptLatencyMin > 5) {
        try {
          await Business.updateOne(
            { _id: existing.businessId },
            {
              $inc: { "health.slowAcceptCount30d": 1 },
              $set: { "health.lastHealthUpdateAt": new Date() },
            }
          );
          await maybeApplySlaAutoPause(existing.businessId, existing._id);
        } catch (healthError: unknown) {
          console.error(
            JSON.stringify({
              type: "business_health_update_error",
              route: "merchant.orders.patch",
              action: "slow_accept",
              businessId: String(existing.businessId),
              orderId: String(existing._id),
              error: healthError instanceof Error ? healthError.message : "Failed to update slow accept counter",
              timestamp: new Date().toISOString(),
            })
          );
        }
      }
    }

    return finish(ok({ order: updated }), 200, {
      orderId,
      businessId: session.businessId,
      status: nextStatus,
    });
  } catch (e: unknown) {
    const err = e as ApiError;
    return finish(fail(err.code || "SERVER_ERROR", err.message || "Could not update order.", err.status || 500), err.status || 500, {
      error: err.message || "Could not update order.",
    });
  }
}
