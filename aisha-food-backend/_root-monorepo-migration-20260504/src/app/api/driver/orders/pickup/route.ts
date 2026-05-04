import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { ok, fail, readJson } from "@/lib/apiResponse";
import { canTransition, isOrderStatus } from "@/lib/orderStatus";
import { requireDriverFromToken } from "@/lib/driverTokenAuth";
import { DispatchAudit } from "@/models/DispatchAudit";
import { Order } from "@/models/Order";

type ApiError = Error & { status?: number; code?: string };

type PickupBody = {
  orderId?: string;
};

type OrderLean = {
  _id: mongoose.Types.ObjectId;
  businessId: mongoose.Types.ObjectId;
  status?: string;
  dispatch?: {
    pickupConfirmedAt?: Date | null;
  };
};

export async function POST(req: Request) {
  try {
    const body = await readJson<PickupBody>(req);
    const orderId = String(body.orderId || "").trim();
    if (!mongoose.Types.ObjectId.isValid(orderId)) {
      return fail("VALIDATION_ERROR", "Valid orderId is required.", 400);
    }

    await dbConnect();
    const driver = await requireDriverFromToken(req);

    const order = await Order.findOne({
      _id: new mongoose.Types.ObjectId(orderId),
      "dispatch.assignedDriverId": driver._id,
    })
      .select("_id businessId status dispatch.pickupConfirmedAt")
      .lean<OrderLean | null>();

    if (!order) return fail("NOT_FOUND", "Order not assigned to this driver.", 404);

    const existingPickup = order.dispatch?.pickupConfirmedAt || null;
    const status = String(order.status || "").trim();
    const normalizedStatus = isOrderStatus(status) ? status : "new";
    const setFields: Record<string, unknown> = {};
    if (!existingPickup) {
      setFields["dispatch.pickupConfirmedAt"] = new Date();
    }
    if (canTransition(normalizedStatus, "preparing")) {
      setFields.status = "preparing";
    }

    if (Object.keys(setFields).length > 0) {
      await Order.updateOne({ _id: order._id }, { $set: setFields });
    }

    let auditId: string | null = null;
    if (!existingPickup) {
      const audit = await DispatchAudit.create({
        orderId: order._id,
        businessId: order.businessId,
        action: "PICKUP_CONFIRMED",
        actor: "driver",
        meta: {
          driverId: driver._id,
          driverName: String(driver.name || "").trim() || null,
        },
      });
      auditId = String(audit._id);
    }

    const updated = await Order.findById(order._id)
      .select("_id status dispatch.pickupConfirmedAt")
      .lean<{
        _id: mongoose.Types.ObjectId;
        status?: string;
        dispatch?: { pickupConfirmedAt?: Date | null };
      } | null>();
    if (!updated) return fail("NOT_FOUND", "Order not found.", 404);

    return ok({
      orderId: String(updated._id),
      status: String(updated.status || ""),
      pickupConfirmedAt: updated.dispatch?.pickupConfirmedAt || null,
      auditId,
    });
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not confirm pickup.",
      err.status || 500
    );
  }
}
