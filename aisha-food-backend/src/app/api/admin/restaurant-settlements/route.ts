import mongoose from "mongoose";
import { ok, fail } from "@/lib/apiResponse";
import { requireAdminKey } from "@/lib/adminAuth";
import { assertNotInMaintenance } from "@/lib/maintenance";
import { dbConnect } from "@/lib/mongodb";
import { syncRestaurantSettlementsForDate, normalizeSettlementDate } from "@/lib/restaurantSettlements";
import { RestaurantSettlement } from "@/models/RestaurantSettlement";

type ApiError = Error & { status?: number; code?: string };

export async function GET(req: Request) {
  try {
    requireAdminKey(req);
    await assertNotInMaintenance();
    await dbConnect();

    const url = new URL(req.url);
    const settlementDate = normalizeSettlementDate(url.searchParams.get("date"));
    const status = String(url.searchParams.get("status") || "").trim().toLowerCase();
    const cityId = String(url.searchParams.get("cityId") || "").trim();
    const q = String(url.searchParams.get("q") || "").trim();

    await syncRestaurantSettlementsForDate(settlementDate);

    const filter: Record<string, unknown> = {
      settlementDate,
      archivedAt: null,
    };
    if (status && ["pending", "paid", "failed", "cancelled"].includes(status)) {
      filter.status = status;
    }
    if (cityId) {
      if (!mongoose.Types.ObjectId.isValid(cityId)) {
        return fail("VALIDATION_ERROR", "Invalid cityId.", 400);
      }
      filter.cityId = new mongoose.Types.ObjectId(cityId);
    }
    if (q) {
      filter.restaurantName = new RegExp(q, "i");
    }

    const rows = await RestaurantSettlement.find(filter)
      .sort({ settlementDate: -1, restaurantName: 1 })
      .lean();

    return ok({
      settlementDate,
      rows: rows.map((row) => ({
        id: String(row._id),
        cityId: row.cityId ? String(row.cityId) : null,
        merchantId: String(row.merchantId),
        restaurantName: String(row.restaurantName || ""),
        settlementDate: String(row.settlementDate || ""),
        periodStart: row.periodStart || null,
        periodEnd: row.periodEnd || null,
        currency: String(row.currency || "XOF"),
        grossSales: Number(row.grossSales || 0),
        platformCommission: Number(row.platformCommission || 0),
        deliveryFeesCollected: Number(row.deliveryFeesCollected || 0),
        restaurantNet: Number(row.restaurantNet || 0),
        orderCount: Number(row.orderCount || 0),
        payoutMethod: String(row.payoutMethod || "cash"),
        payoutAccountName: String(row.payoutAccountName || ""),
        payoutAccountNumber: String(row.payoutAccountNumber || ""),
        payoutNotes: String(row.payoutNotes || ""),
        status: String(row.status || "pending"),
        paidAt: row.paidAt || null,
        paidBy: String(row.paidBy || ""),
        payoutReference: String(row.payoutReference || ""),
        adminNote: String(row.adminNote || ""),
        archivedAt: row.archivedAt || null,
      })),
    });
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not load restaurant settlements.",
      err.status || 500
    );
  }
}
