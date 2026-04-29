import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { ok, fail } from "@/lib/apiResponse";
import { requireAdminKey } from "@/lib/adminAuth";
import { BusinessAudit } from "@/models/BusinessAudit";

type ApiError = Error & { status?: number; code?: string };

export async function GET(req: Request) {
  try {
    requireAdminKey(req);
    const url = new URL(req.url);
    const businessId = String(url.searchParams.get("businessId") || "").trim();
    const limitRaw = Number(url.searchParams.get("limit") || 50);
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(200, Math.floor(limitRaw))) : 50;

    if (businessId && !mongoose.Types.ObjectId.isValid(businessId)) {
      return fail("VALIDATION_ERROR", "Invalid businessId.", 400);
    }

    await dbConnect();
    const filter = businessId ? { businessId: new mongoose.Types.ObjectId(businessId) } : {};
    const events = await BusinessAudit.find(filter)
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    return ok({ events });
  } catch (e: unknown) {
    const err = e as ApiError;
    return fail(err.code || "SERVER_ERROR", err.message || "Could not load business audit events.", err.status || 500);
  }
}
