import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { ok, fail, readJson } from "@/lib/apiResponse";
import { requireAdminKey } from "@/lib/adminAuth";
import { requireActiveCity, resolveCityFromRequest } from "@/lib/city";
import { normalizePromoCode } from "@/lib/promo";
import { City } from "@/models/City";
import { Promo } from "@/models/Promo";
import { PromoCode } from "@/models/PromoCode";

type ApiError = Error & { status?: number; code?: string };

type PromoType = "percentage" | "fixed";
type PromoCodeDiscountType = "percentage" | "flat";

type CreatePromoBody = {
  code?: string;
  cityId?: string;
  discountType?: PromoCodeDiscountType;
  discountValue?: number;
  maxDiscount?: number | null;
  minOrderAmount?: number | null;
  usageLimit?: number | null;
  expiresAt?: string | null;
  type?: PromoType;
  value?: number;
  minSubtotal?: number;
  maxRedemptions?: number | null;
};

function parseLimit(raw: string | null) {
  const parsed = Number(raw || 30);
  if (!Number.isFinite(parsed) || parsed <= 0) return 30;
  return Math.min(100, Math.floor(parsed));
}

function mapLegacyPromo(row: {
  _id: mongoose.Types.ObjectId;
  code?: string;
  type?: PromoType;
  value?: number;
  minSubtotal?: number;
  maxRedemptions?: number | null;
  isActive?: boolean;
  expiresAt?: Date | null;
  createdAt?: Date | null;
}) {
  return {
    _id: String(row._id),
    code: String(row.code || ""),
    cityId: null,
    discountType: row.type === "percentage" ? "percentage" : "flat",
    discountValue: Number(row.value || 0),
    maxDiscount: null,
    minOrderAmount: Number(row.minSubtotal || 0),
    usageLimit: row.maxRedemptions == null ? null : Number(row.maxRedemptions),
    usageCount: null,
    isActive: Boolean(row.isActive),
    expiresAt: row.expiresAt ? new Date(row.expiresAt).toISOString() : null,
    createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : null,
    type: row.type === "percentage" ? "percentage" : "fixed",
    value: Number(row.value || 0),
    minSubtotal: Number(row.minSubtotal || 0),
    maxRedemptions: row.maxRedemptions == null ? null : Number(row.maxRedemptions),
  };
}

function mapPromoCode(row: {
  _id: mongoose.Types.ObjectId;
  cityId?: mongoose.Types.ObjectId | null;
  code?: string;
  discountType?: PromoCodeDiscountType;
  discountValue?: number;
  maxDiscount?: number | null;
  minOrderAmount?: number | null;
  usageLimit?: number | null;
  usageCount?: number | null;
  isActive?: boolean;
  expiresAt?: Date | null;
  createdAt?: Date | null;
}) {
  const discountType = row.discountType === "percentage" ? "percentage" : "flat";
  return {
    _id: String(row._id),
    code: String(row.code || ""),
    cityId: row.cityId ? String(row.cityId) : null,
    discountType,
    discountValue: Number(row.discountValue || 0),
    maxDiscount: row.maxDiscount == null ? null : Number(row.maxDiscount),
    minOrderAmount: row.minOrderAmount == null ? null : Number(row.minOrderAmount),
    usageLimit: row.usageLimit == null ? null : Number(row.usageLimit),
    usageCount: Number(row.usageCount || 0),
    isActive: Boolean(row.isActive),
    expiresAt: row.expiresAt ? new Date(row.expiresAt).toISOString() : null,
    createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : null,
    type: discountType === "percentage" ? "percentage" : "fixed",
    value: Number(row.discountValue || 0),
    minSubtotal: Number(row.minOrderAmount || 0),
    maxRedemptions: row.usageLimit == null ? null : Number(row.usageLimit),
  };
}

export async function GET(req: Request) {
  try {
    requireAdminKey(req);
    const url = new URL(req.url);
    const q = normalizePromoCode(String(url.searchParams.get("q") || ""));
    const activeOnly = ["1", "true", "yes"].includes(
      String(url.searchParams.get("activeOnly") || "").toLowerCase()
    );
    const cityId = String(url.searchParams.get("cityId") || "").trim();
    const limit = parseLimit(url.searchParams.get("limit"));

    await dbConnect();
    const promoCodeQuery: Record<string, unknown> = {};
    const promoQuery: Record<string, unknown> = {};
    if (q) {
      promoCodeQuery.code = { $regex: q, $options: "i" };
      promoQuery.code = { $regex: q, $options: "i" };
    }
    if (activeOnly) {
      promoCodeQuery.isActive = true;
      promoQuery.isActive = true;
    }
    if (cityId && mongoose.Types.ObjectId.isValid(cityId)) {
      promoCodeQuery.cityId = new mongoose.Types.ObjectId(cityId);
    }

    const [promoCodes, legacyPromos] = await Promise.all([
      PromoCode.find(promoCodeQuery).sort({ createdAt: -1 }).limit(limit).lean(),
      Promo.find(promoQuery).sort({ createdAt: -1 }).limit(limit).lean(),
    ]);

    const promos = [
      ...promoCodes.map((row) =>
        mapPromoCode(
          row as {
            _id: mongoose.Types.ObjectId;
            cityId?: mongoose.Types.ObjectId | null;
            code?: string;
            discountType?: PromoCodeDiscountType;
            discountValue?: number;
            maxDiscount?: number | null;
            minOrderAmount?: number | null;
            usageLimit?: number | null;
            usageCount?: number | null;
            isActive?: boolean;
            expiresAt?: Date | null;
            createdAt?: Date | null;
          }
        )
      ),
      ...legacyPromos.map((row) =>
        mapLegacyPromo(
          row as {
            _id: mongoose.Types.ObjectId;
            code?: string;
            type?: PromoType;
            value?: number;
            minSubtotal?: number;
            maxRedemptions?: number | null;
            isActive?: boolean;
            expiresAt?: Date | null;
            createdAt?: Date | null;
          }
        )
      ),
    ]
      .sort((a, b) => {
        const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return bTime - aTime;
      })
      .slice(0, limit);

    return ok({ promos });
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(err.code || "SERVER_ERROR", err.message || "Could not load promos.", err.status || 500);
  }
}

export async function POST(req: Request) {
  try {
    requireAdminKey(req);
    const body = await readJson<CreatePromoBody>(req);
    const code = normalizePromoCode(String(body.code || ""));
    const bodyCityId = String(body.cityId || "").trim();
    const rawDiscountType = String(body.discountType || body.type || "").trim().toLowerCase();
    const discountType: PromoCodeDiscountType =
      rawDiscountType === "percentage" ? "percentage" : "flat";
    const discountValue = Number(
      body.discountValue != null ? body.discountValue : body.value || 0
    );
    const maxDiscount =
      body.maxDiscount == null ? null : Math.max(0, Number(body.maxDiscount || 0));
    const minOrderAmount = Math.max(
      0,
      Number(
        body.minOrderAmount != null ? body.minOrderAmount : body.minSubtotal || 0
      )
    );
    const usageLimitRaw =
      body.usageLimit != null ? body.usageLimit : body.maxRedemptions;
    const usageLimit =
      usageLimitRaw == null || Number(usageLimitRaw) <= 0
        ? null
        : Math.max(1, Number(usageLimitRaw));
    const expiresAt = body.expiresAt ? new Date(body.expiresAt) : null;

    if (!code) {
      return fail("VALIDATION_ERROR", "code is required.", 400);
    }
    if (bodyCityId && !mongoose.Types.ObjectId.isValid(bodyCityId)) {
      return fail("VALIDATION_ERROR", "cityId is invalid.", 400);
    }
    if (!Number.isFinite(discountValue) || discountValue <= 0) {
      return fail("VALIDATION_ERROR", "discountValue must be greater than 0.", 400);
    }
    if (expiresAt && Number.isNaN(expiresAt.getTime())) {
      return fail("VALIDATION_ERROR", "expiresAt is invalid.", 400);
    }

    await dbConnect();
    const selectedCity = bodyCityId
      ? await City.findById(bodyCityId).lean()
      : await resolveCityFromRequest(req);
    if (!selectedCity) {
      return fail("CITY_NOT_FOUND", "City not found.", 404);
    }
    requireActiveCity(selectedCity);

    const promo = await PromoCode.create({
      code,
      cityId: selectedCity._id,
      discountType,
      discountValue,
      maxDiscount,
      minOrderAmount,
      usageLimit,
      usageCount: 0,
      isActive: true,
      expiresAt,
    });

    return ok({
      promo: mapPromoCode(
        promo.toObject() as {
          _id: mongoose.Types.ObjectId;
          cityId?: mongoose.Types.ObjectId | null;
          code?: string;
          discountType?: PromoCodeDiscountType;
          discountValue?: number;
          maxDiscount?: number | null;
          minOrderAmount?: number | null;
          usageLimit?: number | null;
          usageCount?: number | null;
          isActive?: boolean;
          expiresAt?: Date | null;
          createdAt?: Date | null;
        }
      ),
    }, 201);
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(err.code || "SERVER_ERROR", err.message || "Could not create promo.", err.status || 500);
  }
}
