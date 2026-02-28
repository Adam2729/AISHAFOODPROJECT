import mongoose from "mongoose";
import { ok, fail } from "@/lib/apiResponse";
import { requireAdminKey } from "@/lib/adminAuth";
import { getWeekKey } from "@/lib/geo";
import { upsertExpectedCashCollectionsForWeek } from "@/lib/cashCollectionCompute";

type ApiError = Error & { status?: number; code?: string };

export async function GET(req: Request) {
  try {
    requireAdminKey(req);
    const url = new URL(req.url);
    const weekKey = String(url.searchParams.get("weekKey") || "").trim() || getWeekKey(new Date());
    const businessId = String(url.searchParams.get("businessId") || "").trim();

    let businessIds: mongoose.Types.ObjectId[] | undefined;
    if (businessId) {
      if (!mongoose.Types.ObjectId.isValid(businessId)) {
        return fail("VALIDATION_ERROR", "Invalid businessId.", 400);
      }
      businessIds = [new mongoose.Types.ObjectId(businessId)];
    }

    const result = await upsertExpectedCashCollectionsForWeek({
      weekKey,
      businessIds,
    });

    return ok({
      ran: true,
      weekKey,
      updatedCount: result.updatedCount,
      createdCount: result.createdCount,
      scanned: result.scanned,
    });
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not compute cash collections.",
      err.status || 500
    );
  }
}
