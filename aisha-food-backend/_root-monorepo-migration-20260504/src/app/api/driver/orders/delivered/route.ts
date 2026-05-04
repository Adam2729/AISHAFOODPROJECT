import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { ok, fail, readJson } from "@/lib/apiResponse";
import { requireDriverFromToken } from "@/lib/driverTokenAuth";
import { getWeekKey } from "@/lib/geo";
import { roundCurrency } from "@/lib/money";
import { computeDriverCashExpectedHash } from "@/lib/driverCashIntegrity";
import { DispatchAudit } from "@/models/DispatchAudit";
import { DriverCashHandoff } from "@/models/DriverCashHandoff";
import { DriverCashHandoffAudit } from "@/models/DriverCashHandoffAudit";
import { Order } from "@/models/Order";

type ApiError = Error & { status?: number; code?: string };

type DeliveredBody = {
  orderId?: string;
  cashCollected?: boolean;
};

type OrderLean = {
  _id: mongoose.Types.ObjectId;
  businessId: mongoose.Types.ObjectId;
  createdAt?: Date | string;
  total?: number;
  settlement?: {
    weekKey?: string | null;
  } | null;
  status?: string;
  dispatch?: {
    deliveredConfirmedAt?: Date | null;
    cashCollectedByDriver?: boolean;
  };
};

type DriverCashHandoffLean = {
  _id: mongoose.Types.ObjectId;
  orderId: mongoose.Types.ObjectId;
  businessId: mongoose.Types.ObjectId;
  driverId: mongoose.Types.ObjectId;
  weekKey: string;
  amountCollectedRdp: number;
  collectedAt: Date;
  status: "collected" | "handed_to_merchant" | "disputed" | "void";
  integrity?: {
    expectedHash?: string;
    computedAt?: Date;
  };
};

function conflictResponse(message: string) {
  return fail("INTEGRITY_CONFLICT", message, 409);
}

export async function POST(req: Request) {
  try {
    const body = await readJson<DeliveredBody>(req);
    const orderId = String(body.orderId || "").trim();
    if (!mongoose.Types.ObjectId.isValid(orderId)) {
      return fail("VALIDATION_ERROR", "Valid orderId is required.", 400);
    }

    await dbConnect();
    const driver = await requireDriverFromToken(req);
    const cashCollected = Boolean(body.cashCollected);

    const now = new Date();
    const order = await Order.findOne({
      _id: new mongoose.Types.ObjectId(orderId),
      "dispatch.assignedDriverId": driver._id,
    })
      .select(
        "_id businessId total createdAt settlement.weekKey status dispatch.deliveredConfirmedAt dispatch.cashCollectedByDriver"
      )
      .lean<OrderLean | null>();

    if (!order) return fail("NOT_FOUND", "Order not assigned to this driver.", 404);

    const existingDelivered = order.dispatch?.deliveredConfirmedAt || null;
    const updateSet: Record<string, unknown> = {
      "dispatch.cashCollectedByDriver": cashCollected,
    };
    if (!existingDelivered) {
      updateSet["dispatch.deliveredConfirmedAt"] = now;
    }

    await Order.updateOne({ _id: order._id }, { $set: updateSet });

    let auditId: string | null = null;
    if (!existingDelivered) {
      const audit = await DispatchAudit.create({
        orderId: order._id,
        businessId: order.businessId,
        action: "DELIVERED_CONFIRMED",
        actor: "driver",
        meta: {
          driverId: driver._id,
          driverName: String(driver.name || "").trim() || null,
          note: cashCollected ? "cash_collected" : "cash_not_collected",
        },
      });
      auditId = String(audit._id);
    }

    let handoffId: string | null = null;
    let handoffCreated = false;
    let handoffStatus: DriverCashHandoffLean["status"] | null = null;
    if (cashCollected) {
      const weekKey = String(order.settlement?.weekKey || "").trim() || getWeekKey(new Date(order.createdAt || now));
      const amountCollectedRdp = roundCurrency(Number(order.total || 0));
      const collectedAtDate = existingDelivered ? new Date(existingDelivered) : now;
      const collectedAtISO = collectedAtDate.toISOString();

      let handoff = await DriverCashHandoff.findOne({ orderId: order._id }).lean<DriverCashHandoffLean | null>();
      if (!handoff) {
        const expectedHash = computeDriverCashExpectedHash({
          orderId: String(order._id),
          businessId: String(order.businessId),
          driverId: String(driver._id),
          weekKey,
          amountCollectedRdp,
          collectedAtISO,
        });
        try {
          const created = await DriverCashHandoff.create({
            orderId: order._id,
            businessId: order.businessId,
            driverId: driver._id,
            weekKey,
            amountCollectedRdp,
            collectedAt: collectedAtDate,
            status: "collected",
            integrity: {
              expectedHash,
              computedAt: now,
            },
          });
          handoff = created.toObject() as DriverCashHandoffLean;
          handoffCreated = true;
        } catch (error: unknown) {
          const code = String((error as { code?: string | number })?.code || "");
          const message = String((error as { message?: string })?.message || "");
          if (code === "11000" || /E11000/.test(message)) {
            handoff = await DriverCashHandoff.findOne({ orderId: order._id }).lean<DriverCashHandoffLean | null>();
          } else {
            throw error;
          }
        }
      }

      if (!handoff) {
        return fail("SERVER_ERROR", "Could not load driver cash handoff.", 500);
      }

      const immutableMismatch =
        String(handoff.businessId) !== String(order.businessId) ||
        String(handoff.driverId) !== String(driver._id) ||
        String(handoff.weekKey || "").trim() !== weekKey ||
        roundCurrency(Number(handoff.amountCollectedRdp || 0)) !== amountCollectedRdp;
      if (immutableMismatch) {
        return conflictResponse("Existing handoff immutable fields do not match expected values.");
      }

      const expectedFromStored = computeDriverCashExpectedHash({
        orderId: String(handoff.orderId),
        businessId: String(handoff.businessId),
        driverId: String(handoff.driverId),
        weekKey: String(handoff.weekKey || "").trim(),
        amountCollectedRdp: roundCurrency(Number(handoff.amountCollectedRdp || 0)),
        collectedAtISO: new Date(handoff.collectedAt).toISOString(),
      });
      if (String(handoff.integrity?.expectedHash || "") !== expectedFromStored) {
        return conflictResponse("Existing handoff hash integrity mismatch.");
      }

      handoffId = String(handoff._id);
      handoffStatus = handoff.status;
      if (handoffCreated) {
        await DriverCashHandoffAudit.create({
          handoffId: handoff._id,
          orderId: order._id,
          businessId: order.businessId,
          driverId: driver._id,
          weekKey,
          action: "CREATE",
          actor: "driver",
          meta: {
            amount: amountCollectedRdp,
          },
        });
      }
    }

    const updated = await Order.findById(order._id)
      .select("status dispatch.deliveredConfirmedAt dispatch.cashCollectedByDriver")
      .lean<{
        status?: string;
        dispatch?: {
          deliveredConfirmedAt?: Date | null;
          cashCollectedByDriver?: boolean;
        };
      } | null>();

    return ok({
      orderId: String(order._id),
      status: String(updated?.status || order.status || ""),
      deliveredConfirmedAt: updated?.dispatch?.deliveredConfirmedAt || null,
      cashCollectedByDriver: Boolean(updated?.dispatch?.cashCollectedByDriver),
      auditId,
      handoff: handoffId
        ? {
            id: handoffId,
            status: handoffStatus,
            created: handoffCreated,
          }
        : null,
    });
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not confirm delivery.",
      err.status || 500
    );
  }
}
