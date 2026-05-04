import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { ok, fail, readJson } from "@/lib/apiResponse";
import { assertNotInMaintenance } from "@/lib/maintenance";
import { consumeRateLimit } from "@/lib/requestRateLimit";
import { normalizePhone, phoneToHash } from "@/lib/phoneHash";
import { Business } from "@/models/Business";
import { Favorite } from "@/models/Favorite";

type ApiError = Error & { status?: number; code?: string };

type Body = {
  phone?: string;
  businessId?: string;
};

export async function POST(req: Request) {
  try {
    await assertNotInMaintenance();

    const body = await readJson<Body>(req);
    const phoneRaw = String(body.phone || "").trim();
    const businessId = String(body.businessId || "").trim();
    if (!phoneRaw || !businessId) {
      return fail("VALIDATION_ERROR", "phone and businessId are required.", 400);
    }
    if (!mongoose.Types.ObjectId.isValid(businessId)) {
      return fail("VALIDATION_ERROR", "Invalid businessId.", 400);
    }

    const normalizedPhone = normalizePhone(phoneRaw);
    if (!normalizedPhone) {
      return fail("VALIDATION_ERROR", "Invalid phone.", 400);
    }
    const phoneHash = phoneToHash(normalizedPhone);
    const limitState = consumeRateLimit(`public-favorites-toggle:${phoneHash}`, 30, 10 * 60 * 1000);
    if (!limitState.allowed) {
      return fail("RATE_LIMIT", "Too many requests. Try later.", 429);
    }

    await dbConnect();
    const business = await Business.findById(businessId).select("_id isActive").lean();
    if (!business || !business.isActive) {
      return fail("NOT_FOUND", "Business not found.", 404);
    }

    const existing = await Favorite.findOne({
      phoneHash,
      businessId: new mongoose.Types.ObjectId(businessId),
    })
      .select("_id")
      .lean();

    if (existing?._id) {
      await Favorite.deleteOne({ _id: existing._id });
      return ok({ favorited: false });
    }

    await Favorite.create({
      phoneHash,
      businessId: new mongoose.Types.ObjectId(businessId),
    });
    return ok({ favorited: true });
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(err.code || "SERVER_ERROR", err.message || "Could not toggle favorite.", err.status || 500);
  }
}

