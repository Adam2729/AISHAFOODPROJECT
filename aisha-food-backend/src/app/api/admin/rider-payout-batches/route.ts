import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { ok, fail } from "@/lib/apiResponse";
import { requireAdminKey } from "@/lib/adminAuth";
import { assertNotInMaintenance } from "@/lib/maintenance";
import { isValidWeekKey } from "@/lib/riderPayouts";
import { RiderPayoutBatch } from "@/models/RiderPayoutBatch";

type ApiError = Error & { status?: number; code?: string };
type BatchStatus = "open" | "paid" | "void";

function normalizeBatchStatus(value: unknown): BatchStatus | "" {
  const status = String(value || "").trim().toLowerCase();
  if (status === "open" || status === "paid" || status === "void") return status;
  return "";
}

export async function GET(req: Request) {
  try {
    requireAdminKey(req);
    await assertNotInMaintenance();

    const url = new URL(req.url);
    const cityId = String(url.searchParams.get("cityId") || "").trim();
    const weekKey = String(url.searchParams.get("weekKey") || "").trim();
    const status = normalizeBatchStatus(url.searchParams.get("status"));
    const limitRaw = Number(url.searchParams.get("limit") || 50);
    const limit = Math.max(1, Math.min(200, Math.floor(Number.isFinite(limitRaw) ? limitRaw : 50)));

    if (cityId && !mongoose.Types.ObjectId.isValid(cityId)) {
      return fail("VALIDATION_ERROR", "Invalid cityId.", 400);
    }
    if (weekKey && !isValidWeekKey(weekKey)) {
      return fail("VALIDATION_ERROR", "Invalid weekKey.", 400);
    }
    if (String(url.searchParams.get("status") || "").trim() && !status) {
      return fail("VALIDATION_ERROR", "Invalid status.", 400);
    }

    await dbConnect();
    const query: Record<string, unknown> = {};
    if (cityId) query.cityId = new mongoose.Types.ObjectId(cityId);
    if (weekKey) query.weekKey = weekKey;
    if (status) query.status = status;

    const rows = await RiderPayoutBatch.find(query)
      .sort({ createdAt: -1, _id: -1 })
      .limit(limit)
      .lean<
        Array<{
          _id: mongoose.Types.ObjectId;
          cityId: mongoose.Types.ObjectId;
          weekKey: string;
          status: BatchStatus;
          payoutIds?: mongoose.Types.ObjectId[];
          payoutsCount?: number;
          totalAmount?: number;
          totalDeliveryFeeCharged?: number;
          totalPlatformMargin?: number;
          createdByAdminId?: string | null;
          paidByAdminId?: string | null;
          paidAt?: Date | null;
          note?: string | null;
          createdAt?: Date;
          updatedAt?: Date;
        }>
      >();

    return ok({
      rows: rows.map((row) => ({
        id: String(row._id),
        cityId: String(row.cityId),
        weekKey: String(row.weekKey || ""),
        status: row.status,
        payoutIds: Array.isArray(row.payoutIds) ? row.payoutIds.map((id) => String(id)) : [],
        payoutsCount: Number(row.payoutsCount || 0),
        totalAmount: Number(row.totalAmount || 0),
        totalDeliveryFeeCharged: Number(row.totalDeliveryFeeCharged || 0),
        totalPlatformMargin: Number(row.totalPlatformMargin || 0),
        createdByAdminId: String(row.createdByAdminId || "").trim() || null,
        paidByAdminId: String(row.paidByAdminId || "").trim() || null,
        paidAt: row.paidAt || null,
        note: String(row.note || "").trim() || null,
        createdAt: row.createdAt || null,
        updatedAt: row.updatedAt || null,
      })),
    });
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not list rider payout batches.",
      err.status || 500
    );
  }
}
