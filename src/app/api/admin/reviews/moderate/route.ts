import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { ok, fail, readJson } from "@/lib/apiResponse";
import { requireAdminKey } from "@/lib/adminAuth";
import { Review } from "@/models/Review";

type ApiError = Error & { status?: number; code?: string };

type Body = {
  reviewId?: string;
  action?: "hide" | "unhide";
  moderationNote?: string;
  confirm?: string;
};

function normalizeString(value: unknown) {
  return String(value || "").trim();
}

export async function POST(req: Request) {
  try {
    requireAdminKey(req);
    const body = await readJson<Body>(req);
    const reviewId = normalizeString(body.reviewId);
    const action = normalizeString(body.action).toLowerCase();
    const moderationNote = normalizeString(body.moderationNote).slice(0, 200);
    const confirm = normalizeString(body.confirm);

    if (!mongoose.Types.ObjectId.isValid(reviewId)) {
      return fail("VALIDATION_ERROR", "Invalid reviewId.", 400);
    }
    if (action !== "hide" && action !== "unhide") {
      return fail("VALIDATION_ERROR", "action must be hide or unhide.", 400);
    }
    if (confirm !== "MODERATE") {
      return fail("VALIDATION_ERROR", "confirm must be MODERATE.", 400);
    }

    await dbConnect();
    const isHidden = action === "hide";
    const updated = await Review.findOneAndUpdate(
      { _id: new mongoose.Types.ObjectId(reviewId) },
      {
        $set: {
          isHidden,
          moderationNote: moderationNote || "",
          updatedAt: new Date(),
        },
      },
      { returnDocument: "after" }
    )
      .select("_id businessId orderId rating tags comment source createdAt updatedAt isHidden moderationNote")
      .lean();

    if (!updated) return fail("NOT_FOUND", "Review not found.", 404);

    return ok({
      review: {
        reviewId: String(updated._id),
        businessId: String(updated.businessId),
        orderId: String(updated.orderId),
        rating: Number(updated.rating || 0),
        tags: Array.isArray(updated.tags) ? updated.tags : [],
        comment: String(updated.comment || ""),
        source: String(updated.source || "unknown"),
        createdAt: updated.createdAt,
        updatedAt: updated.updatedAt,
        isHidden: Boolean(updated.isHidden),
        moderationNote: String(updated.moderationNote || ""),
      },
    });
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not moderate review.",
      err.status || 500
    );
  }
}

