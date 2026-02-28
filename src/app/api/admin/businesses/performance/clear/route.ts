import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { ok, fail, readJson } from "@/lib/apiResponse";
import { requireAdminKey } from "@/lib/adminAuth";
import { Business } from "@/models/Business";

type ApiError = Error & { status?: number; code?: string };

type Body = {
  businessId?: unknown;
  confirm?: unknown;
};

export async function POST(req: Request) {
  try {
    requireAdminKey(req);
    const body = await readJson<Body>(req);
    const businessId = String(body.businessId || "").trim();
    const confirm = String(body.confirm || "").trim();

    if (!mongoose.Types.ObjectId.isValid(businessId)) {
      return fail("VALIDATION_ERROR", "Invalid businessId.", 400);
    }
    if (confirm !== "CLEAR") {
      return fail("VALIDATION_ERROR", 'confirm must equal "CLEAR".', 400);
    }

    await dbConnect();
    const updated = await Business.findByIdAndUpdate(
      new mongoose.Types.ObjectId(businessId),
      {
        $set: {
          "performance.overrideBoost": 0,
          "performance.overrideTier": null,
          "performance.note": null,
        },
      },
      { returnDocument: "after" }
    )
      .select("name performance")
      .lean();

    if (!updated) return fail("NOT_FOUND", "Business not found.", 404);
    return ok({ business: updated });
  } catch (e: unknown) {
    const err = e as ApiError;
    return fail(err.code || "SERVER_ERROR", err.message || "Could not clear performance override.", err.status || 500);
  }
}
