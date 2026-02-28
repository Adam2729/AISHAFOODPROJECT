import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { ok, fail, readJson } from "@/lib/apiResponse";
import { requireMerchantSession } from "@/lib/merchantAuth";
import { requireMerchantBusinessAvailable } from "@/lib/merchantBusiness";
import { DriverCashHandoff } from "@/models/DriverCashHandoff";
import { DriverCashHandoffAudit } from "@/models/DriverCashHandoffAudit";
import { Order } from "@/models/Order";

type ApiError = Error & { status?: number; code?: string };

type Body = {
  confirm?: string;
  note?: string;
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
    const body = await readJson<Body>(req);
    const confirm = String(body.confirm || "").trim();
    const note = String(body.note || "").trim().slice(0, 280);

    if (!mongoose.Types.ObjectId.isValid(orderId)) {
      return fail("VALIDATION_ERROR", "Invalid orderId.", 400);
    }
    if (confirm !== "RECEIVED") {
      return fail("VALIDATION_ERROR", "confirm must be RECEIVED.", 400);
    }

    const order = await Order.findOne({
      _id: new mongoose.Types.ObjectId(orderId),
      businessId: new mongoose.Types.ObjectId(session.businessId),
    })
      .select("_id businessId")
      .lean<{ _id: mongoose.Types.ObjectId; businessId: mongoose.Types.ObjectId } | null>();
    if (!order) return fail("NOT_FOUND", "Order not found.", 404);

    const handoff = await DriverCashHandoff.findOne({
      orderId: order._id,
      businessId: order.businessId,
    }).lean<{
      _id: mongoose.Types.ObjectId;
      orderId: mongoose.Types.ObjectId;
      businessId: mongoose.Types.ObjectId;
      driverId: mongoose.Types.ObjectId;
      weekKey: string;
      amountCollectedRdp: number;
      status: "collected" | "handed_to_merchant" | "disputed" | "void";
    } | null>();
    if (!handoff) {
      return fail("NO_HANDOFF", "No driver cash handoff exists for this order.", 409);
    }
    if (!["collected", "disputed"].includes(handoff.status)) {
      return fail("INVALID_STATE", "Handoff cannot be marked received from this status.", 409);
    }

    const now = new Date();
    const updated = await DriverCashHandoff.findByIdAndUpdate(
      handoff._id,
      {
        $set: {
          status: "handed_to_merchant",
          handedToMerchantAt: now,
          handedToMerchantBy: "merchant",
        },
      },
      { returnDocument: "after" }
    ).lean<{
      _id: mongoose.Types.ObjectId;
      status: "collected" | "handed_to_merchant" | "disputed" | "void";
      handedToMerchantAt?: Date | null;
      handedToMerchantBy?: string | null;
    } | null>();
    if (!updated) return fail("NOT_FOUND", "Driver cash handoff not found.", 404);

    await DriverCashHandoffAudit.create({
      handoffId: handoff._id,
      orderId: handoff.orderId,
      businessId: handoff.businessId,
      driverId: handoff.driverId,
      weekKey: handoff.weekKey,
      action: "MARK_HANDED",
      actor: "merchant",
      meta: {
        amount: Number(handoff.amountCollectedRdp || 0),
        note: note || null,
      },
    });

    return ok({
      handoff: {
        id: String(updated._id),
        status: updated.status,
        handedToMerchantAt: updated.handedToMerchantAt || null,
        handedToMerchantBy: updated.handedToMerchantBy || null,
      },
    });
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not mark cash as received.",
      err.status || 500
    );
  }
}
