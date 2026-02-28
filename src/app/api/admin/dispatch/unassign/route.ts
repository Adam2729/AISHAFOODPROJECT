import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { ok, fail, readJson } from "@/lib/apiResponse";
import { requireAdminKey } from "@/lib/adminAuth";
import { Business } from "@/models/Business";
import { DispatchAudit } from "@/models/DispatchAudit";
import { Order } from "@/models/Order";

type ApiError = Error & { status?: number; code?: string };

type UnassignBody = {
  orderId?: string;
  confirm?: string;
};

type OrderLean = {
  _id: mongoose.Types.ObjectId;
  businessId: mongoose.Types.ObjectId;
  businessName?: string;
  dispatch?: {
    assignedDriverId?: mongoose.Types.ObjectId | null;
    assignedDriverName?: string | null;
  };
};

export async function POST(req: Request) {
  try {
    requireAdminKey(req);
    const body = await readJson<UnassignBody>(req);
    const orderId = String(body.orderId || "").trim();
    const confirm = String(body.confirm || "").trim();

    if (!mongoose.Types.ObjectId.isValid(orderId)) {
      return fail("VALIDATION_ERROR", "Valid orderId is required.", 400);
    }
    if (confirm !== "UNASSIGN") {
      return fail("VALIDATION_ERROR", "confirm must be UNASSIGN.", 400);
    }

    await dbConnect();
    const order = await Order.findById(orderId)
      .select("_id businessId dispatch.assignedDriverId dispatch.assignedDriverName")
      .lean<OrderLean | null>();
    if (!order) return fail("NOT_FOUND", "Order not found.", 404);

    const business = await Business.findById(order.businessId).select("_id isActive").lean();
    if (!business || !business.isActive) {
      return fail("BUSINESS_NOT_AVAILABLE", "Business is not active.", 409);
    }

    const previousDriverId = order.dispatch?.assignedDriverId || null;
    const previousDriverName = String(order.dispatch?.assignedDriverName || "").trim() || null;

    const updated = await Order.findByIdAndUpdate(
      order._id,
      {
        $set: {
          "dispatch.assignedDriverId": null,
          "dispatch.assignedDriverName": null,
        },
      },
      { returnDocument: "after" }
    )
      .select("_id dispatch.assignedDriverId dispatch.assignedDriverName")
      .lean<{
        _id: mongoose.Types.ObjectId;
        dispatch?: {
          assignedDriverId?: mongoose.Types.ObjectId | null;
          assignedDriverName?: string | null;
        };
      } | null>();

    if (!updated) return fail("NOT_FOUND", "Order not found.", 404);

    const audit = await DispatchAudit.create({
      orderId: order._id,
      businessId: order.businessId,
      action: "UNASSIGN_DRIVER",
      actor: "admin",
      meta: {
        driverId: previousDriverId,
        driverName: previousDriverName,
      },
    });

    return ok({
      orderId: String(updated._id),
      dispatch: {
        assignedDriverId: null,
        assignedDriverName: null,
      },
      auditId: String(audit._id),
    });
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not unassign driver.",
      err.status || 500
    );
  }
}
