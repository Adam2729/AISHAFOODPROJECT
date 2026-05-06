import mongoose from "mongoose";
import { ok, fail, readJson } from "@/lib/apiResponse";
import { requireAdminKey } from "@/lib/adminAuth";
import { assertNotInMaintenance } from "@/lib/maintenance";
import { dbConnect } from "@/lib/mongodb";
import { normalizePayoutMethod } from "@/lib/merchantOnboarding";
import { queueMerchantPayoutPaidWhatsApp } from "@/lib/whatsappNotifications";
import { RestaurantSettlement } from "@/models/RestaurantSettlement";

type ApiError = Error & { status?: number; code?: string };

type Body = {
  action?: "mark_paid" | "edit" | "archive";
  payoutMethod?: string;
  payoutAccountName?: string;
  payoutAccountNumber?: string;
  payoutNotes?: string;
  payoutReference?: string;
  adminNote?: string;
  status?: "pending" | "paid" | "failed" | "cancelled";
  reason?: string;
};

function text(value: unknown, max: number) {
  return String(value || "").trim().slice(0, max);
}

export async function PATCH(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    requireAdminKey(req);
    await assertNotInMaintenance();
    await dbConnect();

    const { id } = await context.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return fail("VALIDATION_ERROR", "Invalid settlement id.", 400);
    }

    const body = await readJson<Body>(req);
    const action = String(body.action || "").trim().toLowerCase();
    if (!["mark_paid", "edit", "archive"].includes(action)) {
      return fail("VALIDATION_ERROR", "Invalid settlement action.", 400);
    }

    const settlement = await RestaurantSettlement.findById(id);
    if (!settlement || settlement.archivedAt) {
      return fail("NOT_FOUND", "Settlement not found.", 404);
    }

    if (action === "archive") {
      const reason = text(body.reason, 280);
      settlement.archivedAt = new Date();
      settlement.archivedBy = "admin_key";
      settlement.archivedReason = reason;
      await settlement.save();
      return ok({ id, status: "archived" });
    }

    if (body.payoutMethod !== undefined) {
      settlement.payoutMethod = normalizePayoutMethod(body.payoutMethod);
    }
    if (body.payoutAccountName !== undefined) {
      settlement.payoutAccountName = text(body.payoutAccountName, 120);
    }
    if (body.payoutAccountNumber !== undefined) {
      settlement.payoutAccountNumber = text(body.payoutAccountNumber, 120);
    }
    if (body.payoutNotes !== undefined) {
      settlement.payoutNotes = text(body.payoutNotes, 400);
    }
    if (body.payoutReference !== undefined) {
      settlement.payoutReference = text(body.payoutReference, 160);
    }
    if (body.adminNote !== undefined) {
      settlement.adminNote = text(body.adminNote, 500);
    }

    if (action === "mark_paid") {
      if (!text(body.payoutReference, 160)) {
        return fail("VALIDATION_ERROR", "payoutReference is required to mark settlement paid.", 400);
      }
      settlement.status = "paid";
      settlement.paidAt = new Date();
      settlement.paidBy = "admin_key";
      await settlement.save();
      await queueMerchantPayoutPaidWhatsApp({
        settlementId: settlement._id,
        businessId: settlement.merchantId,
        cityId: settlement.cityId || null,
        restaurantName: settlement.restaurantName,
        currency: settlement.currency || "XOF",
        netAmount: Number(settlement.restaurantNet || 0),
        payoutReference: settlement.payoutReference || text(body.payoutReference, 160),
        source: "admin.restaurant_settlements.mark_paid",
      }).catch(() => null);
      return ok({ id, status: settlement.status, paidAt: settlement.paidAt });
    }

    if (body.status) {
      if (!["pending", "paid", "failed", "cancelled"].includes(body.status)) {
        return fail("VALIDATION_ERROR", "Invalid settlement status.", 400);
      }
      settlement.status = body.status;
      if (body.status === "paid") {
        settlement.paidAt = settlement.paidAt || new Date();
        settlement.paidBy = settlement.paidBy || "admin_key";
      }
    }

    await settlement.save();
    return ok({
      id,
      status: settlement.status,
      payoutMethod: settlement.payoutMethod,
      payoutAccountName: settlement.payoutAccountName,
      payoutAccountNumber: settlement.payoutAccountNumber,
      payoutNotes: settlement.payoutNotes,
      payoutReference: settlement.payoutReference,
      adminNote: settlement.adminNote,
    });
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not update restaurant settlement.",
      err.status || 500
    );
  }
}
