import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { ok, fail, readJson } from "@/lib/apiResponse";
import { requireAdminKey } from "@/lib/adminAuth";
import { DriverCashHandoff } from "@/models/DriverCashHandoff";
import { DriverCashHandoffAudit } from "@/models/DriverCashHandoffAudit";

type ApiError = Error & { status?: number; code?: string };

type Body = {
  orderId?: string;
  reason?: string;
  confirm?: string;
};

export async function POST(req: Request) {
  try {
    requireAdminKey(req);
    const body = await readJson<Body>(req);
    const orderId = String(body.orderId || "").trim();
    const reason = String(body.reason || "").trim().slice(0, 280);
    const confirm = String(body.confirm || "").trim();

    if (!mongoose.Types.ObjectId.isValid(orderId)) {
      return fail("VALIDATION_ERROR", "Valid orderId is required.", 400);
    }
    if (confirm !== "DISPUTE") {
      return fail("VALIDATION_ERROR", "confirm must be DISPUTE.", 400);
    }
    if (!reason) {
      return fail("VALIDATION_ERROR", "reason is required.", 400);
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
      status: "collected" | "handed_to_merchant" | "disputed" | "void";
    } | null>();
    if (!handoff) return fail("NOT_FOUND", "Driver cash handoff not found.", 404);
    if (handoff.status === "void") {
      return fail("INVALID_STATE", "Cannot dispute a void handoff.", 409);
    }

    const now = new Date();
    const updated = await DriverCashHandoff.findByIdAndUpdate(
      handoff._id,
      {
        $set: {
          status: "disputed",
          "dispute.openedAt": now,
          "dispute.openedBy": "admin",
          "dispute.reason": reason,
          "dispute.resolvedAt": null,
          "dispute.resolution": null,
        },
      },
      { returnDocument: "after" }
    ).lean<{
      _id: mongoose.Types.ObjectId;
      status: "collected" | "handed_to_merchant" | "disputed" | "void";
      dispute?: {
        openedAt?: Date | null;
        openedBy?: "merchant" | "admin" | null;
        reason?: string | null;
      };
    } | null>();
    if (!updated) return fail("NOT_FOUND", "Driver cash handoff not found.", 404);

    await DriverCashHandoffAudit.create({
      handoffId: handoff._id,
      orderId: handoff.orderId,
      businessId: handoff.businessId,
      driverId: handoff.driverId,
      weekKey: handoff.weekKey,
      action: "DISPUTE_OPEN",
      actor: "admin",
      meta: {
        reason,
      },
    });

    return ok({
      handoff: {
        id: String(updated._id),
        status: updated.status,
        dispute: {
          openedAt: updated.dispute?.openedAt || null,
          openedBy: updated.dispute?.openedBy || null,
          reason: String(updated.dispute?.reason || "").trim() || null,
        },
      },
    });
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not open dispute.",
      err.status || 500
    );
  }
}
