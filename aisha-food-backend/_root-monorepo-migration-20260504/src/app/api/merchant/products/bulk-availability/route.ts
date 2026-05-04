import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { ok, fail, readJson } from "@/lib/apiResponse";
import { requireMerchantSession } from "@/lib/merchantAuth";
import { requireMerchantBusinessAvailable } from "@/lib/merchantBusiness";
import { Product } from "@/models/Product";

type ApiError = Error & { status?: number; code?: string };
type AvailabilityReason = "out_of_stock" | "busy" | "closed";
type BulkMode = "all" | "category" | "selected";
type Body = {
  mode?: BulkMode;
  category?: string;
  productIds?: string[];
  isAvailable?: boolean;
  reason?: AvailabilityReason;
};

const MODES = new Set<BulkMode>(["all", "category", "selected"]);
const REASONS = new Set<AvailabilityReason>(["out_of_stock", "busy", "closed"]);

export async function POST(req: Request) {
  try {
    const session = requireMerchantSession(req);
    const body = await readJson<Body>(req);
    const mode = String(body.mode || "").trim() as BulkMode;
    const isAvailable = body.isAvailable;
    const category = String(body.category || "").trim();
    const reason = String(body.reason || "").trim();
    const productIdsRaw = Array.isArray(body.productIds) ? body.productIds : [];

    if (!MODES.has(mode)) return fail("VALIDATION_ERROR", "Invalid mode.", 400);
    if (typeof isAvailable !== "boolean") {
      return fail("VALIDATION_ERROR", "isAvailable boolean is required.", 400);
    }
    if (!isAvailable && reason && !REASONS.has(reason as AvailabilityReason)) {
      return fail("VALIDATION_ERROR", "Invalid reason.", 400);
    }

    const filter: Record<string, unknown> = {
      businessId: new mongoose.Types.ObjectId(session.businessId),
    };
    if (mode === "category") {
      if (!category) return fail("VALIDATION_ERROR", "category is required for category mode.", 400);
      filter.category = category;
    }
    if (mode === "selected") {
      if (!productIdsRaw.length) {
        return fail("VALIDATION_ERROR", "productIds is required for selected mode.", 400);
      }
      if (productIdsRaw.length > 100) {
        return fail("VALIDATION_ERROR", "productIds max 100.", 400);
      }
      const ids = productIdsRaw.filter((id) => mongoose.Types.ObjectId.isValid(String(id)));
      if (!ids.length || ids.length !== productIdsRaw.length) {
        return fail("VALIDATION_ERROR", "Invalid productIds.", 400);
      }
      filter._id = { $in: ids.map((id) => new mongoose.Types.ObjectId(String(id))) };
    }

    await dbConnect();
    await requireMerchantBusinessAvailable(session.businessId);
    const result = await Product.updateMany(filter, {
      $set: {
        isAvailable,
        unavailableReason: isAvailable ? null : (reason || "out_of_stock"),
        unavailableUpdatedAt: new Date(),
        stockHint: isAvailable ? "in_stock" : "out",
      },
    });

    return ok({
      matchedCount: Number(result.matchedCount || 0),
      modifiedCount: Number(result.modifiedCount || 0),
    });
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not perform bulk availability update.",
      err.status || 500
    );
  }
}
