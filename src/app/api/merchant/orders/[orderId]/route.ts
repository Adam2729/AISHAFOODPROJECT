import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { ok, fail, readJson } from "@/lib/apiResponse";
import { requireMerchantSession } from "@/lib/merchantAuth";
import { requireMerchantBusinessAvailable } from "@/lib/merchantBusiness";
import { Order } from "@/models/Order";
import { Settlement } from "@/models/Settlement";
import { getWeekKey } from "@/lib/geo";
import { canTransition, isFinalStatus, isOrderStatus, type OrderStatus } from "@/lib/orderStatus";
import { logRequest } from "@/lib/logger";

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

export async function PATCH(
  req: Request,
  { params }: { params: { orderId: string } }
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
    const session = requireMerchantSession(req);
    const { orderId } = params;
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
        { new: true }
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
        await Settlement.findOneAndUpdate(settlementQuery, settlementUpdate, { upsert: true, new: true });
      } catch (e: unknown) {
        const msg = String((e as { message?: string })?.message || "");
        const code = String((e as { code?: number | string })?.code || "");
        if (code === "11000" || /E11000/.test(msg)) {
          await Settlement.findOneAndUpdate(settlementQuery, settlementUpdate, { upsert: true, new: true });
        } else {
          throw e;
        }
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
      { new: true }
    );
    if (!updated) return finish(fail("CONFLICT", "Order was updated by another process. Retry.", 409), 409, {
      orderId,
      businessId: session.businessId,
    });
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
