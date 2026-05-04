import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { ok, fail, readJson } from "@/lib/apiResponse";
import { requireMerchantSession } from "@/lib/merchantAuth";
import { requireMerchantBusinessAvailable } from "@/lib/merchantBusiness";
import { Product } from "@/models/Product";

type ApiError = Error & { status?: number; code?: string };
type AvailabilityReason = "out_of_stock" | "busy" | "closed";
type Body = {
  isAvailable?: boolean;
  reason?: AvailabilityReason;
};

const REASONS = new Set<AvailabilityReason>(["out_of_stock", "busy", "closed"]);

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ productId: string }> }
) {
  try {
    const session = requireMerchantSession(req);
    const { productId } = await params;
    if (!mongoose.Types.ObjectId.isValid(productId)) {
      return fail("VALIDATION_ERROR", "Invalid productId.", 400);
    }

    const body = await readJson<Body>(req);
    if (typeof body.isAvailable !== "boolean") {
      return fail("VALIDATION_ERROR", "isAvailable boolean is required.", 400);
    }
    const reason = body.reason ? String(body.reason).trim() : "";
    if (!body.isAvailable && reason && !REASONS.has(reason as AvailabilityReason)) {
      return fail("VALIDATION_ERROR", "Invalid reason.", 400);
    }

    await dbConnect();
    await requireMerchantBusinessAvailable(session.businessId);
    const now = new Date();
    const product = await Product.findOneAndUpdate(
      {
        _id: new mongoose.Types.ObjectId(productId),
        businessId: new mongoose.Types.ObjectId(session.businessId),
      },
      {
        $set: {
          isAvailable: body.isAvailable,
          unavailableReason: body.isAvailable ? null : (reason || "out_of_stock"),
          unavailableUpdatedAt: now,
          stockHint: body.isAvailable ? "in_stock" : "out",
        },
      },
      { returnDocument: "after" }
    ).lean();
    if (!product) return fail("NOT_FOUND", "Product not found.", 404);
    return ok({ product });
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not update product availability.",
      err.status || 500
    );
  }
}
