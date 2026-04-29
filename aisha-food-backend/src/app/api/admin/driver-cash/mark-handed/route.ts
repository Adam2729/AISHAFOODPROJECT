import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { ok, fail, readJson } from "@/lib/apiResponse";
import { requireAdminKey } from "@/lib/adminAuth";
import { getWeekKey } from "@/lib/geo";
import { DriverCashHandoff } from "@/models/DriverCashHandoff";
import { DriverCashHandoffAudit } from "@/models/DriverCashHandoffAudit";
import { OpsEvent } from "@/models/OpsEvent";

type ApiError = Error & { status?: number; code?: string };

type Body = {
  orderId?: string;
  handedToMerchantBy?: string;
  receiptRef?: string;
  proofUrl?: string;
  confirm?: string;
};

export async function POST(req: Request) {
  try {
    requireAdminKey(req);
    const body = await readJson<Body>(req);
    const orderId = String(body.orderId || "").trim();
    const handedToMerchantBy = String(body.handedToMerchantBy || "").trim().slice(0, 60);
    const receiptRef = String(body.receiptRef || "").trim().slice(0, 120);
    const proofUrl = String(body.proofUrl || "").trim().slice(0, 500);
    const confirm = String(body.confirm || "").trim();

    if (!mongoose.Types.ObjectId.isValid(orderId)) {
      return fail("VALIDATION_ERROR", "Valid orderId is required.", 400);
    }
    if (confirm !== "HANDOFF") {
      return fail("VALIDATION_ERROR", "confirm must be HANDOFF.", 400);
    }
    if (!handedToMerchantBy) {
      return fail("VALIDATION_ERROR", "handedToMerchantBy is required.", 400);
    }

    await dbConnect();
    const handoff = await DriverCashHandoff.findOne({
      orderId: new mongoose.Types.ObjectId(orderId),
    }).lean<{
      _id: mongoose.Types.ObjectId;
      orderId: mongoose.Types.ObjectId;
      businessId: mongoose.Types.ObjectId;
      driverId: mongoose.Types.ObjectId;
      weekKey: string;
      amountCollectedRdp: number;
      status: "collected" | "handed_to_merchant" | "disputed" | "void";
    } | null>();
    if (!handoff) return fail("NOT_FOUND", "Driver cash handoff not found.", 404);
    if (!["collected", "disputed"].includes(handoff.status)) {
      return fail("INVALID_STATE", "Handoff cannot be marked handed from this status.", 409);
    }

    const now = new Date();
    const updated = await DriverCashHandoff.findByIdAndUpdate(
      handoff._id,
      {
        $set: {
          status: "handed_to_merchant",
          handedToMerchantAt: now,
          handedToMerchantBy,
          receiptRef: receiptRef || null,
          proofUrl: proofUrl || null,
        },
      },
      { returnDocument: "after" }
    ).lean<{
      _id: mongoose.Types.ObjectId;
      status: "collected" | "handed_to_merchant" | "disputed" | "void";
      handedToMerchantAt?: Date | null;
      handedToMerchantBy?: string | null;
      receiptRef?: string | null;
      proofUrl?: string | null;
    } | null>();
    if (!updated) return fail("NOT_FOUND", "Driver cash handoff not found.", 404);

    await DriverCashHandoffAudit.create({
      handoffId: handoff._id,
      orderId: handoff.orderId,
      businessId: handoff.businessId,
      driverId: handoff.driverId,
      weekKey: handoff.weekKey,
      action: "MARK_HANDED",
      actor: "admin",
      meta: {
        amount: Number(handoff.amountCollectedRdp || 0),
        receiptRef: receiptRef || null,
        proofUrl: proofUrl || null,
        note: handedToMerchantBy,
      },
    });

    try {
      await OpsEvent.create({
        type: "CASH_HANDOFF_MARKED",
        severity: "low",
        weekKey: String(handoff.weekKey || "").trim() || getWeekKey(now),
        businessId: handoff.businessId,
        businessName: "dispatch",
        meta: {
          orderId: String(handoff.orderId),
          handoffId: String(handoff._id),
        },
      });
    } catch {
      // no-op: ops event should not block handoff update
    }

    return ok({
      handoff: {
        id: String(updated._id),
        status: updated.status,
        handedToMerchantAt: updated.handedToMerchantAt || null,
        handedToMerchantBy: String(updated.handedToMerchantBy || "").trim() || null,
        receiptRef: String(updated.receiptRef || "").trim() || null,
        proofUrl: String(updated.proofUrl || "").trim() || null,
      },
    });
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not mark handoff as handed.",
      err.status || 500
    );
  }
}
