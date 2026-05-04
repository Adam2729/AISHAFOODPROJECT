import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { ok, fail, readJson } from "@/lib/apiResponse";
import { requireMerchantSession } from "@/lib/merchantAuth";
import { requireMerchantBusinessAvailable } from "@/lib/merchantBusiness";
import { DispatchAudit } from "@/models/DispatchAudit";
import { Order } from "@/models/Order";

type ApiError = Error & { status?: number; code?: string };

type DispatchNoteBody = {
  note?: string;
};

type OrderLean = {
  _id: mongoose.Types.ObjectId;
  businessId: mongoose.Types.ObjectId;
  dispatch?: {
    handoffNote?: string | null;
  };
};

export async function POST(
  req: Request,
  { params }: { params: Promise<{ orderId: string }> }
) {
  try {
    const session = requireMerchantSession(req);
    await dbConnect();
    await requireMerchantBusinessAvailable(session.businessId);
    const { orderId } = await params;
    if (!mongoose.Types.ObjectId.isValid(orderId)) {
      return fail("VALIDATION_ERROR", "Invalid orderId.", 400);
    }

    const body = await readJson<DispatchNoteBody>(req);
    const note = String(body.note || "").trim().slice(0, 200);

    const order = await Order.findOne({
      _id: new mongoose.Types.ObjectId(orderId),
      businessId: new mongoose.Types.ObjectId(session.businessId),
    })
      .select("_id businessId dispatch.handoffNote")
      .lean<OrderLean | null>();
    if (!order) return fail("NOT_FOUND", "Order not found.", 404);

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
      actor: "merchant",
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
