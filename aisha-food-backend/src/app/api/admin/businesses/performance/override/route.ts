import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { ok, fail, readJson } from "@/lib/apiResponse";
import { requireAdminKey } from "@/lib/adminAuth";
import { Business } from "@/models/Business";

type ApiError = Error & { status?: number; code?: string };
type Tier = "gold" | "silver" | "bronze" | "probation";

type Body = {
  businessId?: unknown;
  overrideBoost?: unknown;
  overrideTier?: unknown;
  note?: unknown;
  confirm?: unknown;
};

function normalizeOverrideTier(value: unknown): Tier | null {
  if (value === null) return null;
  const tier = String(value || "").trim().toLowerCase();
  if (tier === "gold" || tier === "silver" || tier === "bronze" || tier === "probation") {
    return tier;
  }
  return null;
}

export async function POST(req: Request) {
  try {
    requireAdminKey(req);
    const body = await readJson<Body>(req);

    const businessId = String(body.businessId || "").trim();
    const confirm = String(body.confirm || "").trim();
    if (!mongoose.Types.ObjectId.isValid(businessId)) {
      return fail("VALIDATION_ERROR", "Invalid businessId.", 400);
    }
    if (confirm !== "OVERRIDE") {
      return fail("VALIDATION_ERROR", 'confirm must equal "OVERRIDE".', 400);
    }

    const hasBoost = Object.prototype.hasOwnProperty.call(body, "overrideBoost");
    const hasTier = Object.prototype.hasOwnProperty.call(body, "overrideTier");
    const hasNote = Object.prototype.hasOwnProperty.call(body, "note");
    if (!hasBoost && !hasTier && !hasNote) {
      return fail("VALIDATION_ERROR", "No override fields provided.", 400);
    }

    const updateSet: Record<string, unknown> = {};

    if (hasBoost) {
      const parsedBoost = Number(body.overrideBoost);
      if (!Number.isFinite(parsedBoost)) {
        return fail("VALIDATION_ERROR", "overrideBoost must be a number.", 400);
      }
      updateSet["performance.overrideBoost"] = Math.max(-50, Math.min(50, Math.round(parsedBoost)));
    }

    if (hasTier) {
      const rawTier = body.overrideTier;
      if (rawTier === null || String(rawTier || "").trim() === "") {
        updateSet["performance.overrideTier"] = null;
      } else {
        const tier = normalizeOverrideTier(rawTier);
        if (!tier) {
          return fail("VALIDATION_ERROR", "Invalid overrideTier.", 400);
        }
        updateSet["performance.overrideTier"] = tier;
      }
    }

    if (hasNote) {
      const note = String(body.note || "").trim();
      if (note.length > 200) {
        return fail("VALIDATION_ERROR", "note must be 200 characters or less.", 400);
      }
      updateSet["performance.note"] = note || null;
    }

    await dbConnect();
    const updated = await Business.findByIdAndUpdate(
      new mongoose.Types.ObjectId(businessId),
      { $set: updateSet },
      { returnDocument: "after" }
    )
      .select("name performance")
      .lean();

    if (!updated) return fail("NOT_FOUND", "Business not found.", 404);
    return ok({ business: updated });
  } catch (e: unknown) {
    const err = e as ApiError;
    return fail(err.code || "SERVER_ERROR", err.message || "Could not apply performance override.", err.status || 500);
  }
}
