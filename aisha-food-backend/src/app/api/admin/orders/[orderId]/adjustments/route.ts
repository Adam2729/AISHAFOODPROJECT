import mongoose from "mongoose";
import { ok, fail, readJson } from "@/lib/apiResponse";
import { requireAdminKey } from "@/lib/adminAuth";
import { dbConnect } from "@/lib/mongodb";
import {
  buildOrderEvent,
  getOrderAdjustmentTypeLabel,
  isOrderAdjustmentType,
  type OrderAdjustmentType,
} from "@/lib/orderOperations";
import { Order } from "@/models/Order";

type ApiError = Error & { status?: number; code?: string };

type AdjustmentBody = {
  adjustmentType?: string;
  amount?: number;
  reason?: string;
  note?: string;
  createdBy?: string;
};

type OrderLean = {
  _id: mongoose.Types.ObjectId;
  total?: number | null;
  adjustments?: Array<{
    adjustmentType?: string | null;
    amount?: number | null;
    reason?: string | null;
    note?: string | null;
    createdBy?: string | null;
    createdAt?: Date | null;
  }> | null;
};

export async function POST(
  req: Request,
  { params }: { params: Promise<{ orderId: string }> }
) {
  try {
    requireAdminKey(req);
    await dbConnect();

    const { orderId } = await params;
    if (!mongoose.Types.ObjectId.isValid(orderId)) {
      return fail("VALIDATION_ERROR", "Invalid orderId.", 400);
    }

    const body = await readJson<AdjustmentBody>(req);
    const adjustmentTypeRaw = String(body.adjustmentType || "").trim();
    const reason = String(body.reason || "").trim().slice(0, 140);
    const note = String(body.note || "").trim().slice(0, 280);
    const createdBy = String(body.createdBy || "").trim().slice(0, 80);
    const amount = Number(body.amount);

    if (!isOrderAdjustmentType(adjustmentTypeRaw)) {
      return fail("VALIDATION_ERROR", "Valid adjustmentType is required.", 400);
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      return fail("VALIDATION_ERROR", "amount must be a positive number.", 400);
    }
    if (!reason) {
      return fail("VALIDATION_ERROR", "reason is required.", 400);
    }
    if (!createdBy) {
      return fail("VALIDATION_ERROR", "createdBy is required.", 400);
    }

    const adjustmentType: OrderAdjustmentType = adjustmentTypeRaw;
    const orderObjectId = new mongoose.Types.ObjectId(orderId);
    const existing = await Order.findById(orderObjectId)
      .select("_id total adjustments")
      .lean<OrderLean | null>();
    if (!existing) return fail("NOT_FOUND", "Order not found.", 404);

    const now = new Date();
    const adjustmentLabel = getOrderAdjustmentTypeLabel(adjustmentType);
    const updated = await Order.findByIdAndUpdate(
      orderObjectId,
      {
        $push: {
          adjustments: {
            $each: [
              {
                adjustmentType,
                amount,
                reason,
                note,
                createdBy,
                createdAt: now,
              },
            ],
            $slice: -30,
          },
          orderEvents: {
            $each: [
              buildOrderEvent({
                type: "adjustment_recorded",
                label: "Adjustment recorded",
                detail: `${adjustmentLabel}: ${reason}`,
                actor: createdBy,
                createdAt: now,
              }),
            ],
            $slice: -40,
          },
        },
      },
      { returnDocument: "after" }
    ).lean<OrderLean | null>();
    if (!updated) return fail("NOT_FOUND", "Order not found.", 404);

    return ok({
      adjustment: {
        adjustmentType,
        label: adjustmentLabel,
        amount,
        reason,
        note: note || null,
        createdBy,
        createdAt: now,
      },
      order: {
        id: String(updated._id),
        total: Number(updated.total || 0),
        adjustmentsCount: Array.isArray(updated.adjustments) ? updated.adjustments.length : 0,
      },
    });
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not record order adjustment.",
      err.status || 500
    );
  }
}
