import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { ok, fail, readJson } from "@/lib/apiResponse";
import { requireAdminKey } from "@/lib/adminAuth";
import { DriverCashHandoff } from "@/models/DriverCashHandoff";
import { DriverCashHandoffAudit } from "@/models/DriverCashHandoffAudit";

type ApiError = Error & { status?: number; code?: string };

type Resolution = "merchant_confirmed" | "driver_confirmed" | "writeoff";

type Body = {
  orderId?: string;
  resolution?: Resolution;
  note?: string;
  confirm?: string;
};

function isResolution(value: string): value is Resolution {
  return value === "merchant_confirmed" || value === "driver_confirmed" || value === "writeoff";
}

export async function POST(req: Request) {
  try {
    requireAdminKey(req);
    const body = await readJson<Body>(req);
    const orderId = String(body.orderId || "").trim();
    const resolution = String(body.resolution || "").trim();
    const note = String(body.note || "").trim().slice(0, 280);
    const confirm = String(body.confirm || "").trim();

    if (!mongoose.Types.ObjectId.isValid(orderId)) {
      return fail("VALIDATION_ERROR", "Valid orderId is required.", 400);
    }
    if (!isResolution(resolution)) {
      return fail("VALIDATION_ERROR", "Invalid resolution.", 400);
    }
    if (confirm !== "RESOLVE") {
      return fail("VALIDATION_ERROR", "confirm must be RESOLVE.", 400);
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
      handedToMerchantAt?: Date | null;
    } | null>();
    if (!handoff) return fail("NOT_FOUND", "Driver cash handoff not found.", 404);
    if (handoff.status !== "disputed") {
      return fail("INVALID_STATE", "Handoff must be disputed before resolution.", 409);
    }

    const now = new Date();
    let nextStatus: "collected" | "handed_to_merchant" | "void" = "collected";
    if (resolution === "merchant_confirmed") {
      nextStatus = handoff.handedToMerchantAt ? "handed_to_merchant" : "collected";
    } else if (resolution === "driver_confirmed") {
      nextStatus = "collected";
    } else if (resolution === "writeoff") {
      nextStatus = "void";
    }

    const updated = await DriverCashHandoff.findByIdAndUpdate(
      handoff._id,
      {
        $set: {
          status: nextStatus,
          "dispute.resolvedAt": now,
          "dispute.resolution": resolution,
        },
      },
      { returnDocument: "after" }
    ).lean<{
      _id: mongoose.Types.ObjectId;
      status: "collected" | "handed_to_merchant" | "disputed" | "void";
      dispute?: {
        resolvedAt?: Date | null;
        resolution?: Resolution | null;
      };
    } | null>();
    if (!updated) return fail("NOT_FOUND", "Driver cash handoff not found.", 404);

    await DriverCashHandoffAudit.create({
      handoffId: handoff._id,
      orderId: handoff.orderId,
      businessId: handoff.businessId,
      driverId: handoff.driverId,
      weekKey: handoff.weekKey,
      action: "DISPUTE_RESOLVE",
      actor: "admin",
      meta: {
        resolution,
        note: note || null,
      },
    });

    return ok({
      handoff: {
        id: String(updated._id),
        status: updated.status,
        dispute: {
          resolvedAt: updated.dispute?.resolvedAt || null,
          resolution: updated.dispute?.resolution || null,
        },
      },
    });
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not resolve dispute.",
      err.status || 500
    );
  }
}
