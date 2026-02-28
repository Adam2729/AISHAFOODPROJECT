import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { ok, fail, readJson } from "@/lib/apiResponse";
import { assertNotInMaintenance } from "@/lib/maintenance";
import { BASE_LOCATION, MAX_RADIUS_KM } from "@/lib/constants";
import { getWeekKey, isWithinRadiusKm } from "@/lib/geo";
import { computeSubscriptionStatus } from "@/lib/subscription";
import { buildUpsellSuggestions } from "@/lib/upsellRules";
import { buildRateLimitIdentity, rateLimitMany } from "@/lib/rateLimit";
import { Business } from "@/models/Business";
import { OpsEvent } from "@/models/OpsEvent";
import { Product } from "@/models/Product";

type ApiError = Error & { status?: number; code?: string };

type CartUpsellBody = {
  businessId?: string;
  sessionId?: string;
  items?: Array<{
    productId?: string;
    qty?: number;
  }>;
};

function toNumber(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export async function POST(req: Request) {
  try {
    await assertNotInMaintenance();
    const body = await readJson<CartUpsellBody>(req);
    const businessId = String(body.businessId || "").trim();
    const sessionId = String(body.sessionId || "").trim();
    const items = Array.isArray(body.items) ? body.items : [];

    if (!mongoose.Types.ObjectId.isValid(businessId)) {
      return fail("VALIDATION_ERROR", "Invalid businessId.", 400);
    }
    if (!items.length) {
      return ok({ suggestions: [] });
    }

    const normalizedItems = items
      .map((row) => ({
        productId: String(row.productId || "").trim(),
        qty: Math.max(1, Math.min(50, Math.floor(toNumber(row.qty, 1)))),
      }))
      .filter((row) => mongoose.Types.ObjectId.isValid(row.productId));
    if (!normalizedItems.length) {
      return ok({ suggestions: [] });
    }

    const identity = buildRateLimitIdentity(req, { sessionId });
    const rate = rateLimitMany([
      {
        key: identity.ipHash ? `public.cart.upsell:ip:${identity.ipHash}` : "",
        limit: 80,
        windowMs: 10 * 60 * 1000,
      },
      {
        key: identity.sessionIdHash
          ? `public.cart.upsell:session:${identity.sessionIdHash}`
          : "",
        limit: 50,
        windowMs: 10 * 60 * 1000,
      },
    ]);
    if (!rate.ok) {
      await dbConnect();
      await OpsEvent.create({
        type: "RATE_LIMIT_BLOCKED",
        severity: "low",
        weekKey: getWeekKey(new Date()),
        businessId: null,
        businessName: "system",
        meta: {
          route: "public.cart.upsell",
          ipHash: identity.ipHash || null,
          sessionIdHash: identity.sessionIdHash || null,
          retryAfterSec: rate.retryAfterSec || 60,
        },
      }).catch(() => null);
      const response = fail("RATE_LIMIT", "Too many requests. Try later.", 429);
      response.headers.set("Retry-After", String(rate.retryAfterSec || 60));
      return response;
    }

    await dbConnect();
    const business = await Business.findById(businessId)
      .select("type isActive paused subscription location")
      .lean();
    if (!business || !business.isActive || business.paused) {
      return fail("BUSINESS_NOT_AVAILABLE", "Business is not available.", 404);
    }

    const subscription = computeSubscriptionStatus(
      (business as { subscription?: Record<string, unknown> }).subscription || {}
    );
    if (subscription.status === "suspended") {
      return fail("BUSINESS_SUSPENDED", "Business is not available right now.", 403);
    }

    const businessLat = Number(
      (business as { location?: { coordinates?: [number, number] } }).location?.coordinates?.[1]
    );
    const businessLng = Number(
      (business as { location?: { coordinates?: [number, number] } }).location?.coordinates?.[0]
    );
    const inCluster =
      Number.isFinite(businessLat) &&
      Number.isFinite(businessLng) &&
      isWithinRadiusKm(BASE_LOCATION.lat, BASE_LOCATION.lng, businessLat, businessLng, MAX_RADIUS_KM);
    if (!inCluster) {
      return fail("BUSINESS_OUTSIDE_CLUSTER", "Business is outside coverage cluster.", 400);
    }

    const cartProductIds = normalizedItems.map((row) => new mongoose.Types.ObjectId(row.productId));
    const [availableProductsRaw, cartProductsRaw] = await Promise.all([
      Product.find({
        businessId: new mongoose.Types.ObjectId(businessId),
        isAvailable: true,
      })
        .select("_id name price imageUrl category")
        .lean(),
      Product.find({
        _id: { $in: cartProductIds },
        businessId: new mongoose.Types.ObjectId(businessId),
      })
        .select("_id name price imageUrl category")
        .lean(),
    ]);

    const cartProductMap = new Map(cartProductsRaw.map((row) => [String(row._id), row]));
    const subtotal = normalizedItems.reduce((sum, item) => {
      const product = cartProductMap.get(item.productId);
      return sum + Math.max(0, toNumber(product?.price)) * item.qty;
    }, 0);

    const suggestions = buildUpsellSuggestions({
      businessType: String((business as { type?: string }).type || "unknown"),
      cartItems: normalizedItems,
      cartProducts: cartProductsRaw.map((row) => ({
        productId: String(row._id),
        name: String(row.name || ""),
        price: Math.max(0, toNumber(row.price)),
        imageUrl: String(row.imageUrl || ""),
        category: String(row.category || ""),
      })),
      availableProducts: availableProductsRaw.map((row) => ({
        productId: String(row._id),
        name: String(row.name || ""),
        price: Math.max(0, toNumber(row.price)),
        imageUrl: String(row.imageUrl || ""),
        category: String(row.category || ""),
      })),
      subtotal,
    });

    return ok({
      suggestions: suggestions.map((row) => ({
        productId: row.productId,
        name: row.name,
        price: row.price,
        imageUrl: row.imageUrl,
        category: row.category,
        reasonEs: row.reasonEs,
      })),
    });
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not compute cart suggestions.",
      err.status || 500
    );
  }
}
