import mongoose from "mongoose";
import { ok, fail } from "@/lib/apiResponse";
import { requireAdminKey } from "@/lib/adminAuth";
import { assertNotInMaintenance } from "@/lib/maintenance";
import { dbConnect } from "@/lib/mongodb";
import { DriverPayoutRequest } from "@/models/DriverPayoutRequest";

type ApiError = Error & { status?: number; code?: string };

export async function GET(req: Request) {
  try {
    requireAdminKey(req);
    await assertNotInMaintenance();
    await dbConnect();

    const url = new URL(req.url);
    const status = String(url.searchParams.get("status") || "").trim().toLowerCase();
    const cityId = String(url.searchParams.get("cityId") || "").trim();
    const driverId = String(url.searchParams.get("driverId") || "").trim();
    const limit = Math.max(1, Math.min(200, Number(url.searchParams.get("limit") || 100)));

    const filter: Record<string, unknown> = {
      archivedAt: null,
    };
    if (status && ["requested", "approved", "paid", "rejected", "cancelled"].includes(status)) {
      filter.status = status;
    }
    if (cityId) {
      if (!mongoose.Types.ObjectId.isValid(cityId)) {
        return fail("VALIDATION_ERROR", "Invalid cityId.", 400);
      }
      filter.cityId = new mongoose.Types.ObjectId(cityId);
    }
    if (driverId) {
      if (!mongoose.Types.ObjectId.isValid(driverId)) {
        return fail("VALIDATION_ERROR", "Invalid driverId.", 400);
      }
      filter.driverId = new mongoose.Types.ObjectId(driverId);
    }

    const rows = await DriverPayoutRequest.find(filter)
      .sort({ requestedAt: -1, createdAt: -1 })
      .limit(limit)
      .lean();

    return ok({
      rows: rows.map((row) => ({
        id: String(row._id),
        cityId: row.cityId ? String(row.cityId) : null,
        driverId: String(row.driverId),
        driverName: String(row.driverName || ""),
        currency: String(row.currency || "XOF"),
        requestedAmount: Number(row.requestedAmount || 0),
        availableBalanceAtRequest: Number(row.availableBalanceAtRequest || 0),
        payoutMethod: String(row.payoutMethod || "cash"),
        payoutAccountName: String(row.payoutAccountName || ""),
        payoutAccountNumber: String(row.payoutAccountNumber || ""),
        payoutNotes: String(row.payoutNotes || ""),
        status: String(row.status || "requested"),
        deliveryCount: Number(row.deliveryCount || 0),
        requestedAt: row.requestedAt || null,
        approvedAt: row.approvedAt || null,
        paidAt: row.paidAt || null,
        rejectedAt: row.rejectedAt || null,
        reviewedBy: String(row.reviewedBy || ""),
        payoutReference: String(row.payoutReference || ""),
        adminNote: String(row.adminNote || ""),
        rejectionReason: String(row.rejectionReason || ""),
      })),
    });
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not load driver payout requests.",
      err.status || 500
    );
  }
}
