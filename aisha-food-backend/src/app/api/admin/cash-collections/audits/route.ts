import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { ok, fail } from "@/lib/apiResponse";
import { requireAdminKey } from "@/lib/adminAuth";
import { CashCollectionAudit } from "@/models/CashCollectionAudit";

type ApiError = Error & { status?: number; code?: string };

export async function GET(req: Request) {
  try {
    requireAdminKey(req);
    const url = new URL(req.url);
    const businessId = String(url.searchParams.get("businessId") || "").trim();
    const weekKey = String(url.searchParams.get("weekKey") || "").trim();
    const limitRaw = Number(url.searchParams.get("limit") || 20);
    const limit = Math.max(1, Math.min(100, Math.floor(Number.isFinite(limitRaw) ? limitRaw : 20)));

    if (!mongoose.Types.ObjectId.isValid(businessId)) {
      return fail("VALIDATION_ERROR", "Invalid businessId.", 400);
    }
    if (!weekKey) {
      return fail("VALIDATION_ERROR", "weekKey is required.", 400);
    }

    await dbConnect();
    const rows = await CashCollectionAudit.find({
      businessId: new mongoose.Types.ObjectId(businessId),
      weekKey,
    })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    return ok({
      audits: rows.map((row) => ({
        id: String(row._id),
        businessId: String(row.businessId),
        businessName: String(row.businessName || ""),
        weekKey: String(row.weekKey || ""),
        cashCollectionId: String(row.cashCollectionId || ""),
        actor: row.actor || { type: "system", id: null, label: null },
        action: String(row.action || ""),
        before: row.before || null,
        after: row.after || null,
        note: row.note || null,
        meta: row.meta || null,
        createdAt: row.createdAt || null,
      })),
    });
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not load cash collection audits.",
      err.status || 500
    );
  }
}
