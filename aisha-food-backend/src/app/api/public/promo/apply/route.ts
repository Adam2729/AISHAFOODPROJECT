import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { ok, fail, readJson } from "@/lib/apiResponse";
import { assertNotInMaintenance } from "@/lib/maintenance";
import { requireActiveCity, resolveCityFromRequest } from "@/lib/city";
import {
  computePromoCodeDiscount,
  normalizePromoCode,
  promoCodeReasonToMessage,
} from "@/lib/promo";
import { roundCurrency } from "@/lib/money";
import { City } from "@/models/City";
import { PromoCode } from "@/models/PromoCode";

type ApiError = Error & { status?: number; code?: string };

type ApplyPromoBody = {
  code?: string;
  orderSubtotal?: number;
  cityId?: string;
};

export async function POST(req: Request) {
  try {
    await assertNotInMaintenance();
    const body = await readJson<ApplyPromoBody>(req);
    const code = normalizePromoCode(String(body.code || ""));
    const orderSubtotal = roundCurrency(Number(body.orderSubtotal || 0));
    const bodyCityId = String(body.cityId || "").trim();

    if (!code) {
      return fail("VALIDATION_ERROR", "code is required.", 400);
    }
    if (!Number.isFinite(orderSubtotal) || orderSubtotal <= 0) {
      return fail("VALIDATION_ERROR", "orderSubtotal must be greater than 0.", 400);
    }

    await dbConnect();
    if (bodyCityId && !mongoose.Types.ObjectId.isValid(bodyCityId)) {
      return fail("VALIDATION_ERROR", "cityId is invalid.", 400);
    }

    const selectedCity = bodyCityId
      ? await City.findById(bodyCityId).lean()
      : await resolveCityFromRequest(req);
    if (!selectedCity) {
      return fail("CITY_NOT_FOUND", "City not found.", 404);
    }
    requireActiveCity(selectedCity);

    const promoCode = await PromoCode.findOne({
      code,
      cityId: selectedCity._id,
    }).lean();

    if (!promoCode) {
      return fail("PROMO_NOT_FOUND", "Promo code not found.", 404);
    }

    const result = computePromoCodeDiscount({
      promoCode,
      subtotal: orderSubtotal,
      now: new Date(),
    });

    if (result.discountAmount <= 0) {
      return fail(
        result.reason || "PROMO_INVALID",
        promoCodeReasonToMessage(result.reason),
        400
      );
    }

    return ok({
      code: promoCode.code,
      discount: result.discountAmount,
      finalSubtotal: result.finalSubtotal,
    });
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not apply promo code.",
      err.status || 500
    );
  }
}
