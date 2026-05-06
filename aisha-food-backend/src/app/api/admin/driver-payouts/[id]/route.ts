import mongoose from "mongoose";
import { ok, fail, readJson } from "@/lib/apiResponse";
import { requireAdminKey } from "@/lib/adminAuth";
import { markRiderPayoutsPaid } from "@/lib/riderPayouts";
import { assertNotInMaintenance } from "@/lib/maintenance";
import { dbConnect } from "@/lib/mongodb";
import { normalizePayoutMethod } from "@/lib/merchantOnboarding";
import { queueDriverPayoutPaidWhatsApp } from "@/lib/whatsappNotifications";
import { DriverPayoutRequest } from "@/models/DriverPayoutRequest";

type ApiError = Error & { status?: number; code?: string };

type Body = {
  action?: "approve" | "reject" | "mark_paid" | "cancel" | "edit" | "archive";
  payoutMethod?: string;
  payoutAccountName?: string;
  payoutAccountNumber?: string;
  payoutNotes?: string;
  payoutReference?: string;
  adminNote?: string;
  rejectionReason?: string;
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
      return fail("VALIDATION_ERROR", "Invalid payout request id.", 400);
    }

    const body = await readJson<Body>(req);
    const action = String(body.action || "").trim().toLowerCase();
    if (!["approve", "reject", "mark_paid", "cancel", "edit", "archive"].includes(action)) {
      return fail("VALIDATION_ERROR", "Invalid payout request action.", 400);
    }

    const requestRow = await DriverPayoutRequest.findById(id);
    if (!requestRow || requestRow.archivedAt) {
      return fail("NOT_FOUND", "Payout request not found.", 404);
    }

    if (body.payoutMethod !== undefined) {
      requestRow.payoutMethod = normalizePayoutMethod(body.payoutMethod);
    }
    if (body.payoutAccountName !== undefined) {
      requestRow.payoutAccountName = text(body.payoutAccountName, 120);
    }
    if (body.payoutAccountNumber !== undefined) {
      requestRow.payoutAccountNumber = text(body.payoutAccountNumber, 120);
    }
    if (body.payoutNotes !== undefined) {
      requestRow.payoutNotes = text(body.payoutNotes, 400);
    }
    if (body.payoutReference !== undefined) {
      requestRow.payoutReference = text(body.payoutReference, 160);
    }
    if (body.adminNote !== undefined) {
      requestRow.adminNote = text(body.adminNote, 500);
    }

    if (action === "archive") {
      requestRow.archivedAt = new Date();
      requestRow.archivedBy = "admin_key";
      requestRow.archivedReason = text(body.reason, 280);
      await requestRow.save();
      return ok({ id, status: "archived" });
    }

    if (action === "approve") {
      if (requestRow.status === "paid") {
        return fail("INVALID_STATE", "Paid requests cannot be approved again.", 409);
      }
      requestRow.status = "approved";
      requestRow.approvedAt = requestRow.approvedAt || new Date();
      requestRow.reviewedBy = "admin_key";
      await requestRow.save();
      return ok({ id, status: requestRow.status, approvedAt: requestRow.approvedAt });
    }

    if (action === "reject") {
      const rejectionReason = text(body.rejectionReason || body.reason, 280);
      if (!rejectionReason) {
        return fail("VALIDATION_ERROR", "rejectionReason is required.", 400);
      }
      requestRow.status = "rejected";
      requestRow.rejectionReason = rejectionReason;
      requestRow.rejectedAt = new Date();
      requestRow.reviewedBy = "admin_key";
      await requestRow.save();
      return ok({ id, status: requestRow.status, rejectedAt: requestRow.rejectedAt });
    }

    if (action === "cancel") {
      requestRow.status = "cancelled";
      requestRow.reviewedBy = "admin_key";
      await requestRow.save();
      return ok({ id, status: requestRow.status });
    }

    if (action === "mark_paid") {
      const payoutReference = text(body.payoutReference, 160);
      if (!payoutReference) {
        return fail("VALIDATION_ERROR", "payoutReference is required.", 400);
      }
      const payoutIds = (requestRow.riderPayoutIds || []).map((value: mongoose.Types.ObjectId) =>
        String(value)
      );
      const result = await markRiderPayoutsPaid({
        payoutIds,
        note: body.adminNote,
        paidAt: new Date(),
        paidByAdminId: "admin_key",
        scope: {
          cityId: requestRow.cityId || null,
          driverId: requestRow.driverId,
        },
      });
      requestRow.status = "paid";
      requestRow.paidAt = new Date();
      requestRow.approvedAt = requestRow.approvedAt || new Date();
      requestRow.reviewedBy = "admin_key";
      requestRow.payoutReference = payoutReference;
      await requestRow.save();
      await queueDriverPayoutPaidWhatsApp({
        requestId: requestRow._id,
        driverId: requestRow.driverId,
        cityId: requestRow.cityId || null,
        driverName: requestRow.driverName,
        requestedAmount: Number(requestRow.requestedAmount || 0),
        currency: requestRow.currency || "XOF",
        payoutReference,
        source: "admin.driver_payouts.mark_paid",
      }).catch(() => null);
      return ok({
        id,
        status: requestRow.status,
        paidAt: requestRow.paidAt,
        payoutReference: requestRow.payoutReference,
        updatedPayouts: result.updatedCount,
      });
    }

    await requestRow.save();
    return ok({
      id,
      status: requestRow.status,
      payoutMethod: requestRow.payoutMethod,
      payoutAccountName: requestRow.payoutAccountName,
      payoutAccountNumber: requestRow.payoutAccountNumber,
      payoutNotes: requestRow.payoutNotes,
      payoutReference: requestRow.payoutReference,
      adminNote: requestRow.adminNote,
    });
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not update driver payout request.",
      err.status || 500
    );
  }
}
