import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { ok, fail, readJson } from "@/lib/apiResponse";
import { assertNotInMaintenance } from "@/lib/maintenance";
import { getWeekKey } from "@/lib/geo";
import { phoneToHash } from "@/lib/phoneHash";
import { computePromoDiscount, normalizePromoCode } from "@/lib/promo";
import { budgetBlocksDiscount, getPromoPolicyForWeek } from "@/lib/promoBudget";
import { Promo } from "@/models/Promo";
import { Business } from "@/models/Business";
import { Order } from "@/models/Order";
import { roundCurrency } from "@/lib/money";

type ApiError = Error & { status?: number; code?: string };

type Body = {
  businessId?: string;
  subtotal?: number;
  promoCode?: string;
  phone?: string;
};

export async function POST(req: Request) {
  try {
    await assertNotInMaintenance();
    const body = await readJson<Body>(req);
    const businessId = String(body.businessId || "").trim();
    const subtotal = roundCurrency(Number(body.subtotal || 0));
    const promoCode = normalizePromoCode(String(body.promoCode || ""));
    const phone = String(body.phone || "").trim();

    if (!mongoose.Types.ObjectId.isValid(businessId)) {
      return fail("VALIDATION_ERROR", "Invalid businessId.", 400);
    }
    if (subtotal <= 0) {
      return fail("VALIDATION_ERROR", "subtotal must be greater than 0.", 400);
    }
    if (!promoCode) {
      return fail("VALIDATION_ERROR", "promoCode is required.", 400);
    }
    if (!phone) {
      return fail("VALIDATION_ERROR", "phone is required.", 400);
    }

    await dbConnect();
    const business = await Business.findById(businessId).select("_id isActive paused performance.tier").lean();
    if (!business || !business.isActive) {
      return fail("BUSINESS_NOT_AVAILABLE", "Business is not available.", 404);
    }
    if (business.paused) {
      return fail("BUSINESS_PAUSED", "Este negocio esta pausado temporalmente.", 403);
    }
    const businessTier = String((business as { performance?: { tier?: string } })?.performance?.tier || "bronze")
      .trim()
      .toLowerCase();
    if (businessTier === "probation") {
      return ok({
        valid: false,
        discountAmount: 0,
        subtotalAfter: subtotal,
        message: "Promos no disponibles para este negocio en este momento.",
      });
    }

    const promo = await Promo.findOne({ code: promoCode }).lean();
    if (!promo) {
      return ok({
        valid: false,
        discountAmount: 0,
        subtotalAfter: subtotal,
        message: "Codigo promocional no valido.",
      });
    }

    const phoneHash = phoneToHash(phone);
    const [redemptionCountForPromo, redemptionCountForPhone] = await Promise.all([
      Order.countDocuments({
        "discount.promoId": promo._id,
        status: { $ne: "cancelled" },
      }),
      Order.countDocuments({
        "discount.promoId": promo._id,
        phoneHash,
        status: { $ne: "cancelled" },
      }),
    ]);

    const result = computePromoDiscount({
      promo,
      subtotal,
      businessId,
      phoneHash,
      now: new Date(),
      redemptionCountForPromo,
      redemptionCountForPhone,
    });
    const discountAmount = roundCurrency(result.discountAmount || 0);
    const subtotalAfter = roundCurrency(subtotal - discountAmount);
    const valid = discountAmount > 0;
    if (!valid) {
      return ok({
        valid: false,
        discountAmount: 0,
        subtotalAfter: subtotal,
        message: "El codigo no aplica para este pedido.",
      });
    }

    const weekKey = getWeekKey(new Date());
    const promoPolicy = await getPromoPolicyForWeek(weekKey);
    if (!promoPolicy.promosEnabled) {
      return ok({
        valid: false,
        discountAmount: 0,
        subtotalAfter: subtotal,
        message: "Promos temporalmente deshabilitados.",
      });
    }
    if (budgetBlocksDiscount(promoPolicy.remainingRdp, discountAmount)) {
      return ok({
        valid: false,
        discountAmount: 0,
        subtotalAfter: subtotal,
        message: "Promos temporalmente agotados. Intenta mas tarde.",
      });
    }

    return ok({
      valid: true,
      discountAmount,
      subtotalAfter,
      message: "Promocion aplicada.",
    });
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(err.code || "SERVER_ERROR", err.message || "Could not validate promo.", err.status || 500);
  }
}
