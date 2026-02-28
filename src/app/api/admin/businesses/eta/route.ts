import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { ok, fail, readJson } from "@/lib/apiResponse";
import { requireAdminKey } from "@/lib/adminAuth";
import { clampEta, formatEtaText } from "@/lib/eta";
import { Business } from "@/models/Business";

type Body = {
  businessId?: string;
  minMins?: number;
  maxMins?: number;
  prepMins?: number;
};

type ApiError = Error & { status?: number; code?: string };

export async function PATCH(req: Request) {
  try {
    requireAdminKey(req);
    const body = await readJson<Body>(req);
    const businessId = String(body.businessId || "").trim();
    if (!mongoose.Types.ObjectId.isValid(businessId)) {
      return fail("VALIDATION_ERROR", "Invalid businessId.", 400);
    }
    const minRaw = Number(body.minMins);
    const maxRaw = Number(body.maxMins);
    const prepRaw = Number(body.prepMins);
    if (!Number.isFinite(minRaw) || !Number.isFinite(maxRaw) || !Number.isFinite(prepRaw)) {
      return fail("VALIDATION_ERROR", "minMins, maxMins and prepMins are required.", 400);
    }

    const normalized = clampEta(minRaw, maxRaw, prepRaw);
    if (normalized.minMins > normalized.maxMins) {
      return fail("VALIDATION_ERROR", "minMins cannot be greater than maxMins.", 400);
    }

    await dbConnect();
    const updated = await Business.findByIdAndUpdate(
      businessId,
      {
        $set: {
          "eta.minMins": normalized.minMins,
          "eta.maxMins": normalized.maxMins,
          "eta.prepMins": normalized.prepMins,
        },
      },
      { new: true, lean: true }
    );
    if (!updated) {
      return fail("NOT_FOUND", "Business not found.", 404);
    }

    return ok({
      business: {
        businessId: String(updated._id),
        name: String((updated as { name?: string }).name || ""),
        eta: {
          minMins: normalized.minMins,
          maxMins: normalized.maxMins,
          prepMins: normalized.prepMins,
          text: formatEtaText(normalized.minMins, normalized.maxMins),
        },
      },
    });
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not update ETA.",
      err.status || 500
    );
  }
}

