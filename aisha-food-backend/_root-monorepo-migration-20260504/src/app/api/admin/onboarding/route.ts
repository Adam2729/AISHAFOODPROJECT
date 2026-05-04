import crypto from "node:crypto";
import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { ok, fail, readJson } from "@/lib/apiResponse";
import { requireAdminKey } from "@/lib/adminAuth";
import { hashSecret } from "@/lib/password";
import { Business } from "@/models/Business";

type ApiError = Error & { status?: number; code?: string };

type Body = {
  businessId?: string;
};

function generatePin() {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
}

export async function GET(req: Request) {
  try {
    requireAdminKey(req);
    const url = new URL(req.url);
    const limitRaw = Number(url.searchParams.get("limit") || 20);
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(100, Math.floor(limitRaw))) : 20;

    await dbConnect();
    const businesses = await Business.find({})
      .sort({ createdAt: -1 })
      .limit(limit)
      .select("name type isActive auth.mustChange createdAt")
      .lean();

    const merchants = businesses.map((b) => ({
      businessId: String(b._id),
      name: b.name,
      type: b.type,
      isActive: Boolean(b.isActive),
      mustChangePin: Boolean((b as { auth?: { mustChange?: boolean } }).auth?.mustChange),
      createdAt: b.createdAt,
    }));

    return ok({ merchants });
  } catch (e: unknown) {
    const err = e as ApiError;
    return fail(err.code || "SERVER_ERROR", err.message || "Could not load onboarding merchants.", err.status || 500);
  }
}

export async function POST(req: Request) {
  try {
    requireAdminKey(req);
    const body = await readJson<Body>(req);
    const businessId = String(body.businessId || "").trim();
    if (!mongoose.Types.ObjectId.isValid(businessId)) {
      return fail("VALIDATION_ERROR", "Invalid businessId.", 400);
    }

    await dbConnect();
    const business = await Business.findById(businessId);
    if (!business) return fail("NOT_FOUND", "Business not found.", 404);

    const temporaryPin = generatePin();
    business.set("auth.pinHash", hashSecret(temporaryPin));
    business.set("auth.mustChange", true);
    await business.save();

    return ok({
      onboarding: {
        businessId: String(business._id),
        businessName: business.name,
        temporaryPin,
        loginPath: "/merchant/login",
        mustChangePin: true,
      },
    });
  } catch (e: unknown) {
    const err = e as ApiError;
    return fail(err.code || "SERVER_ERROR", err.message || "Could not generate onboarding PIN.", err.status || 500);
  }
}
