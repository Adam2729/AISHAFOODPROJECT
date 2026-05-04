import mongoose from "mongoose";
import { ok, fail } from "@/lib/apiResponse";
import { requireAdminKey } from "@/lib/adminAuth";
import { dbConnect } from "@/lib/mongodb";
import { SettlementAudit } from "@/models/SettlementAudit";

type ApiError = Error & { status?: number; code?: string };

export async function GET(req: Request) {
  try {
    requireAdminKey(req);

    const url = new URL(req.url);
    const businessId = String(url.searchParams.get("businessId") || "").trim();
    const weekKey = String(url.searchParams.get("weekKey") || "").trim();
    const limitRaw = Number(url.searchParams.get("limit") || 50);
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(200, Math.floor(limitRaw))) : 50;

    const hasBusinessId = businessId.length > 0;
    const hasWeekKey = weekKey.length > 0;
    if (hasBusinessId !== hasWeekKey) {
      return fail("VALIDATION_ERROR", "businessId and weekKey are required together.", 400);
    }
    if (hasBusinessId && !mongoose.Types.ObjectId.isValid(businessId)) {
      return fail("VALIDATION_ERROR", "Invalid businessId.", 400);
    }

    await dbConnect();
    const filter = hasBusinessId
      ? {
          businessId: new mongoose.Types.ObjectId(businessId),
          weekKey,
        }
      : {};

    const events = await SettlementAudit.find(filter)
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    return ok({ events });
  } catch (e: unknown) {
    const err = e as ApiError;
    return fail(err.code || "SERVER_ERROR", err.message || "Could not load audit events.", err.status || 500);
  }
}
