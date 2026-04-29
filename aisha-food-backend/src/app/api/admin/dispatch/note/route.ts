import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { ok, fail, readJson } from "@/lib/apiResponse";
import { requireAdminKey } from "@/lib/adminAuth";
import { Business } from "@/models/Business";
import { DispatchAudit } from "@/models/DispatchAudit";
import { Order } from "@/models/Order";

type ApiError = Error & { status?: number; code?: string };

type NoteBody = {
  orderId?: string;
  note?: string;
  confirm?: string;
};

type OrderLean = {
  _id: mongoose.Types.ObjectId;
  businessId: mongoose.Types.ObjectId;
};

export async function POST(req: Request) {
  try {
    requireAdminKey(req);
    const body = await readJson<NoteBody>(req);
    const orderId = String(body.orderId || "").trim();
    const note = String(body.note || "").trim().slice(0, 200);
    const confirm = String(body.confirm || "").trim();

    if (!mongoose.Types.ObjectId.isValid(orderId)) {
      return fail("VALIDATION_ERROR", "Valid orderId is required.", 400);
    }
    if (confirm !== "NOTE") {
      return fail("VALIDATION_ERROR", "confirm must be NOTE.", 400);
    }

    await dbConnect();
    const order = await Order.findById(orderId).select("_id businessId").lean<OrderLean | null>();
    if (!order) return fail("NOT_FOUND", "Order not found.", 404);

    const business = await Business.findById(order.businessId).select("_id isActive").lean();
    if (!business || !business.isActive) {
      return fail("BUSINESS_NOT_AVAILABLE", "Business is not active.", 409);
    }

    await Order.updateOne(
      { _id: order._id },
      {
        $set: {
          "dispatch.handoffNote": note || null,
        },
      }
    );

    const audit = await DispatchAudit.create({
      orderId: order._id,
      businessId: order.businessId,
      action: "CASH_HANDOFF_NOTE",
      actor: "admin",
      meta: {
        note: note || null,
      },
    });

    return ok({
      orderId: String(order._id),
      handoffNote: note || null,
      auditId: String(audit._id),
    });
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not save dispatch note.",
      err.status || 500
    );
  }
}
