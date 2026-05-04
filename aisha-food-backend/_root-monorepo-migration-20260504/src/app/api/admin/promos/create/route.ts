import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { ok, fail, readJson } from "@/lib/apiResponse";
import { requireAdminKey } from "@/lib/adminAuth";
import { normalizePromoCode } from "@/lib/promo";
import { PROMO_CODE_MAX_LEN, PROMO_MAX_FIXED_RDP, PROMO_MAX_PERCENT } from "@/lib/constants";
import { Promo } from "@/models/Promo";

type ApiError = Error & { status?: number; code?: string };

type Body = {
  code?: string;
  type?: "percentage" | "fixed";
  value?: number;
  minSubtotal?: number;
  expiresAt?: string | null;
  maxRedemptions?: number | null;
  perPhoneLimit?: number;
  businessAllowlist?: string[] | null;
};

const CODE_REGEX = /^[A-Z0-9\-_]+$/;

export async function POST(req: Request) {
  try {
    requireAdminKey(req);
    const body = await readJson<Body>(req);
    const code = normalizePromoCode(String(body.code || ""));
    const type = body.type;
    const value = Number(body.value || 0);
    const minSubtotal = Math.max(0, Number(body.minSubtotal || 0));
    const perPhoneLimit = Math.max(1, Number(body.perPhoneLimit || 1));
    const maxRedemptions =
      body.maxRedemptions == null || body.maxRedemptions === 0 ? null : Math.max(1, Number(body.maxRedemptions));
    const expiresAt = body.expiresAt ? new Date(body.expiresAt) : null;
    const allowlistRaw = Array.isArray(body.businessAllowlist) ? body.businessAllowlist : [];
    const businessAllowlist = allowlistRaw
      .map((id) => String(id || "").trim())
      .filter((id) => mongoose.Types.ObjectId.isValid(id))
      .map((id) => new mongoose.Types.ObjectId(id));

    if (!code || code.length > PROMO_CODE_MAX_LEN || !CODE_REGEX.test(code)) {
      return fail("VALIDATION_ERROR", "Invalid promo code format.", 400);
    }
    if (type !== "percentage" && type !== "fixed") {
      return fail("VALIDATION_ERROR", "type must be percentage or fixed.", 400);
    }
    if (type === "percentage" && (value < 1 || value > PROMO_MAX_PERCENT)) {
      return fail("VALIDATION_ERROR", `percentage value must be 1..${PROMO_MAX_PERCENT}.`, 400);
    }
    if (type === "fixed" && (value < 1 || value > PROMO_MAX_FIXED_RDP)) {
      return fail("VALIDATION_ERROR", `fixed value must be 1..${PROMO_MAX_FIXED_RDP}.`, 400);
    }
    if (expiresAt && Number.isNaN(expiresAt.getTime())) {
      return fail("VALIDATION_ERROR", "expiresAt is invalid.", 400);
    }

    await dbConnect();
    const promo = await Promo.create({
      code,
      type,
      value,
      minSubtotal,
      expiresAt,
      maxRedemptions,
      perPhoneLimit,
      businessAllowlist: businessAllowlist.length ? businessAllowlist : [],
      fundedBy: "platform",
      isActive: true,
    });

    return ok({ promo }, 201);
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(err.code || "SERVER_ERROR", err.message || "Could not create promo.", err.status || 500);
  }
}
