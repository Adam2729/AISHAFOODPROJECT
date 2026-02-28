/* eslint-disable @typescript-eslint/no-explicit-any */
import { createHash } from "node:crypto";
import mongoose from "mongoose";
import { NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import { ok, fail, readJson } from "@/lib/apiResponse";
import {
  COMMISSION_RATE_DEFAULT,
  REFERRALS_ENABLED,
  SUPPORT_WHATSAPP_DEFAULT_TEXT,
  SUPPORT_WHATSAPP_E164,
  DEV_ALLOW_ORDER_LOCATION_BYPASS,
} from "@/lib/constants";
import { getWeekKey } from "@/lib/geo";
import { roundCurrency } from "@/lib/money";
import { computeSubscriptionStatus } from "@/lib/subscription";
import { geocodeAddress, isValidLatLng } from "@/lib/googleMaps";
import { generateUniqueOrderNumber, isDuplicateKeyError } from "@/lib/orderNumber";
import { runSubscriptionStatusJob } from "@/lib/subscriptionJob";
import { logRequest } from "@/lib/logger";
import { assertNotInMaintenance } from "@/lib/maintenance";
import { assertPilotAllowed } from "@/lib/pilot";
import { buildRateLimitIdentity } from "@/lib/rateLimit";
import { hit as hitRateLimit } from "@/lib/rateLimitStore";
import { phoneToHash } from "@/lib/phoneHash";
import { computePromoDiscount, normalizePromoCode } from "@/lib/promo";
import { budgetBlocksDiscount, getPromoPolicyForWeek } from "@/lib/promoBudget";
import { isBusinessOpenNow } from "@/lib/businessHours";
import { computeOrderEtaSnapshot } from "@/lib/eta";
import { statusLabelEs } from "@/lib/orderStatusView";
import { DELIVERY_DISCLAIMER_ES, getPublicDeliveryInfo } from "@/lib/deliveryPolicy";
import { deriveOrderOtp, hashOtp } from "@/lib/deliveryOtp";
import {
  buildCityScopedFilter,
  getCityCenter,
  getDefaultCity,
  isBusinessWithinCityCoverage,
  isDefaultCity,
  isWithinCityCoverage,
  normalizeMoneyCurrency,
  requireActiveCity,
  resolveCityFromRequest,
} from "@/lib/city";
import { computeDeliveryFeeForOrder } from "@/lib/deliveryFees";
import { attachRequestIdHeader, getOrCreateRequestId } from "@/lib/requestId";
import { Business } from "@/models/Business";
import { Product } from "@/models/Product";
import { Order } from "@/models/Order";
import { Promo } from "@/models/Promo";
import { Customer } from "@/models/Customer";
import { IdempotencyKey } from "@/models/IdempotencyKey";
import { OpsEvent } from "@/models/OpsEvent";

type OrderItemInput = {
  productId: string;
  qty: number;
};

type CreateOrderBody = {
  customerName?: string;
  phone?: string;
  sessionId?: string;
  address?: string;
  lat?: number;
  lng?: number;
  city?: string;
  cityId?: string;
  businessId?: string;
  items?: OrderItemInput[];
  promoCode?: string;
  referralCode?: string;
  applyWalletCredit?: boolean;
  orderSource?: string;
  campaignId?: string;
  idempotencyKey?: string;
};

type PromoLean = {
  _id: mongoose.Types.ObjectId;
  code: string;
  type: "percentage" | "fixed";
  value: number;
  minSubtotal?: number;
  expiresAt?: Date | null;
  maxRedemptions?: number | null;
  perPhoneLimit?: number;
  businessAllowlist?: mongoose.Types.ObjectId[];
  fundedBy?: "platform";
  isActive?: boolean;
};

type CustomerLean = {
  _id: mongoose.Types.ObjectId;
  phoneHash: string;
  referralCode?: string | null;
  walletCreditRdp?: number;
  deliveredCount?: number;
  firstDeliveredAt?: Date | null;
};

type OrderSource = "organic" | "whatsapp" | "flyer" | "merchant_referral";

const ALLOWED_ORDER_SOURCES = new Set<OrderSource>([
  "organic",
  "whatsapp",
  "flyer",
  "merchant_referral",
]);
const CAMPAIGN_ID_REGEX = /^[A-Z0-9\-_]+$/;

function trustBadgeFromTier(tierRaw: string) {
  const tier = String(tierRaw || "").trim().toLowerCase();
  if (tier === "gold") return "top";
  if (tier === "silver") return "good";
  if (tier === "probation") return "at_risk";
  return "new";
}

function normalizeString(v: unknown) {
  return String(v || "").trim();
}

function referralCodeNormalize(v: string) {
  return String(v || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function promoReasonToMessage(reason?: string) {
  switch (reason) {
    case "PROMO_INACTIVE":
      return "Este codigo promocional no esta activo.";
    case "PROMO_EXPIRED":
      return "Este codigo promocional ya vencio.";
    case "MIN_SUBTOTAL_NOT_MET":
      return "Este codigo requiere un subtotal minimo.";
    case "BUSINESS_NOT_ELIGIBLE":
      return "Este codigo no aplica para este negocio.";
    case "PROMO_EXHAUSTED":
      return "Este codigo ya alcanzo su limite de uso.";
    case "PHONE_LIMIT_REACHED":
      return "Este codigo ya fue usado para este numero.";
    default:
      return "No se pudo aplicar el codigo promocional.";
  }
}

type IdempotencyStoredResponse = {
  statusCode?: number | null;
  bodyJson?: Record<string, unknown> | null;
};

type IdempotencyRow = {
  response?: IdempotencyStoredResponse | null;
};

function hashIdempotencyKey(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function retryAfterFromIso(resetAtIso: string) {
  const resetAtMs = new Date(resetAtIso).getTime();
  if (!Number.isFinite(resetAtMs)) return 60;
  return Math.max(1, Math.ceil((resetAtMs - Date.now()) / 1000));
}

async function waitForIdempotencyResponse(keyHash: string, timeoutMs = 8000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const row = await IdempotencyKey.findOne({ keyHash, route: "public.orders.create" })
      .select("response.statusCode response.bodyJson")
      .lean<IdempotencyRow | null>();
    const statusCode = Number(row?.response?.statusCode || 0);
    const bodyJson = row?.response?.bodyJson;
    if (statusCode >= 100 && bodyJson && typeof bodyJson === "object") {
      return {
        statusCode,
        bodyJson,
      };
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return null;
}

export async function POST(req: Request) {
  const startedAt = Date.now();
  const requestId = getOrCreateRequestId(req);
  let idempotencyKeyHash = "";
  let shouldStoreIdempotencyResponse = false;
  let idempotencyResponseStored = false;
  const finish = async (
    response: Response,
    status: number,
    extra?: Record<string, unknown>
  ) => {
    const responseWithRequestId = attachRequestIdHeader(response, requestId);
    if (shouldStoreIdempotencyResponse && idempotencyKeyHash && !idempotencyResponseStored) {
      try {
        const bodyJson = (await responseWithRequestId.clone().json()) as Record<string, unknown>;
        await IdempotencyKey.updateOne(
          { keyHash: idempotencyKeyHash, route: "public.orders.create" },
          {
            $set: {
              response: {
                statusCode: status,
                bodyJson,
              },
            },
          }
        );
        idempotencyResponseStored = true;
      } catch {
        // no-op: do not break request flow on idempotency persistence issues
      }
    }
    logRequest(req, {
      route: "public.orders.create",
      status,
      durationMs: Date.now() - startedAt,
      requestId,
      extra,
    });
    return responseWithRequestId;
  };

  try {
    await assertNotInMaintenance();
    const selectedCity = await resolveCityFromRequest(req);
    requireActiveCity(selectedCity);
    const defaultCity = await getDefaultCity();
    const includeUnassignedBusiness = isDefaultCity(selectedCity, defaultCity._id);
    const cityCenter = getCityCenter(selectedCity);
    const cityRadiusKm = Number(selectedCity.maxDeliveryRadiusKm || 0) > 0
      ? Number(selectedCity.maxDeliveryRadiusKm)
      : 8;

    const body = await readJson<CreateOrderBody>(req);
    const customerName = normalizeString(body.customerName);
    const phone = normalizeString(body.phone);
    const address = normalizeString(body.address);
    const businessId = normalizeString(body.businessId);
    const city = normalizeString(body.city) || String(selectedCity.name || "").trim() || "Santo Domingo";
    const items = Array.isArray(body.items) ? body.items : [];
    const promoCodeRaw = normalizePromoCode(normalizeString(body.promoCode));
    const referralCodeRaw = referralCodeNormalize(normalizeString(body.referralCode));
    const applyWalletCredit = Boolean(body.applyWalletCredit);
    const rawOrderSource = normalizeString(body.orderSource).toLowerCase();
    const orderSource = (rawOrderSource || "organic") as OrderSource;
    const rawCampaignId = normalizeString(body.campaignId).toUpperCase();
    const campaignId = rawCampaignId || null;
    const sessionId = normalizeString(body.sessionId);
    const idempotencyKey = normalizeString(
      req.headers.get("Idempotency-Key") || body.idempotencyKey
    ).slice(0, 200);

    let lat = Number(body.lat);
    let lng = Number(body.lng);
    const coordsProvided = isValidLatLng(lat, lng);
    const hasGoogleKey = Boolean(String(process.env.GOOGLE_MAPS_API_KEY || "").trim());
    const allowDevLocationBypass =
      DEV_ALLOW_ORDER_LOCATION_BYPASS && process.env.NODE_ENV !== "production";

    if (!customerName || !phone || !address || !businessId) {
      return finish(fail("VALIDATION_ERROR", "customerName, phone, address and businessId are required."), 400);
    }
    if (!mongoose.Types.ObjectId.isValid(businessId)) {
      return finish(fail("VALIDATION_ERROR", "Invalid businessId."), 400, { businessId });
    }
    if (!items.length) {
      return finish(fail("VALIDATION_ERROR", "At least one item is required."), 400, { businessId });
    }
    if (!items.every((it) => mongoose.Types.ObjectId.isValid(String(it.productId)) && Number(it.qty) > 0)) {
      return finish(fail("VALIDATION_ERROR", "Invalid productId/qty in items."), 400, { businessId });
    }
    if (!ALLOWED_ORDER_SOURCES.has(orderSource)) {
      return finish(fail("VALIDATION_ERROR", "Invalid orderSource."), 400, { businessId, orderSource });
    }
    if (campaignId) {
      if (campaignId.length > 40 || !CAMPAIGN_ID_REGEX.test(campaignId)) {
        return finish(fail("VALIDATION_ERROR", "Invalid campaignId."), 400, { businessId });
      }
    }
    await assertPilotAllowed(phone);
    const phoneHash = phoneToHash(phone);
    const rateIdentity = buildRateLimitIdentity(req, { phoneHash, sessionId });
    await dbConnect();

    if (idempotencyKey) {
      idempotencyKeyHash = hashIdempotencyKey(idempotencyKey);
      const existing = await IdempotencyKey.findOne({
        keyHash: idempotencyKeyHash,
        route: "public.orders.create",
      })
        .select("response.statusCode response.bodyJson")
        .lean<IdempotencyRow | null>();
      const existingStatusCode = Number(existing?.response?.statusCode || 0);
      const existingBodyJson = existing?.response?.bodyJson;
      if (existingStatusCode >= 100 && existingBodyJson && typeof existingBodyJson === "object") {
        const replay = NextResponse.json(existingBodyJson, { status: existingStatusCode });
        replay.headers.set("x-idempotency-replayed", "true");
        return finish(replay, existingStatusCode, { replayed: true });
      }

      if (!existing) {
        try {
          await IdempotencyKey.create({
            keyHash: idempotencyKeyHash,
            route: "public.orders.create",
            phoneHash: phoneHash || null,
            response: null,
          });
          shouldStoreIdempotencyResponse = true;
        } catch (error: unknown) {
          if (!isDuplicateKeyError(error)) throw error;
          const waited = await waitForIdempotencyResponse(idempotencyKeyHash);
          if (waited) {
            const replay = NextResponse.json(waited.bodyJson, { status: waited.statusCode });
            replay.headers.set("x-idempotency-replayed", "true");
            return finish(replay, waited.statusCode, { replayed: true });
          }
          return finish(
            fail(
              "IDEMPOTENCY_IN_PROGRESS",
              "Another request with this Idempotency-Key is still processing.",
              409
            ),
            409
          );
        }
      } else {
        const waited = await waitForIdempotencyResponse(idempotencyKeyHash);
        if (waited) {
          const replay = NextResponse.json(waited.bodyJson, { status: waited.statusCode });
          replay.headers.set("x-idempotency-replayed", "true");
          return finish(replay, waited.statusCode, { replayed: true });
        }
        return finish(
          fail(
            "IDEMPOTENCY_IN_PROGRESS",
            "Another request with this Idempotency-Key is still processing.",
            409
          ),
          409
        );
      }
    }

    const phoneRate = await hitRateLimit("public.orders.phone", phoneHash, {
      windowSec: 5 * 60,
      limit: 10,
    });
    if (!phoneRate.allowed) {
      const retryAfterSec = retryAfterFromIso(phoneRate.resetAtIso);
      await dbConnect();
      await OpsEvent.create({
        type: "RATE_LIMIT_BLOCKED",
        severity: "medium",
        weekKey: getWeekKey(new Date()),
        businessId: null,
        businessName: "system",
        meta: {
          route: "public.orders.create",
          ipHash: rateIdentity.ipHash || null,
          sessionIdHash: rateIdentity.sessionIdHash || null,
          phoneHash: rateIdentity.phoneHash || null,
          retryAfterSec,
        },
      }).catch(() => null);
      const response = await finish(
        fail("RATE_LIMIT", "Demasiadas solicitudes. Intenta de nuevo en un momento.", 429),
        429,
        {
          ipHash: rateIdentity.ipHash || null,
          sessionIdHash: rateIdentity.sessionIdHash || null,
          phoneHash: rateIdentity.phoneHash || null,
        }
      );
      response.headers.set("Retry-After", String(retryAfterSec));
      return response;
    }

    if (!coordsProvided) {
      if (!hasGoogleKey) {
        if (allowDevLocationBypass) {
          lat = cityCenter.lat;
          lng = cityCenter.lng;
        } else {
          return finish(
            fail(
              "LOCATION_REQUIRED",
              "No pudimos validar tu direccion ahora. Usa 'Usar mi ubicacion' y reintenta.",
              400
            ),
            400,
            { businessId }
          );
        }
      } else {
        const geo = await geocodeAddress(address, city);
        if (!geo) {
          if (allowDevLocationBypass) {
            lat = cityCenter.lat;
            lng = cityCenter.lng;
          } else {
            return finish(
              fail(
                "GEOCODE_FAILED",
                "No pudimos ubicar tu direccion. Agrega sector y numero o usa tu ubicacion GPS.",
                400
              ),
              400,
              { businessId }
            );
          }
        } else {
          lat = geo.lat;
          lng = geo.lng;
        }
      }
    }

    const withinCoverage = isWithinCityCoverage(selectedCity, lat, lng);
    if (!withinCoverage) {
      if (allowDevLocationBypass) {
        lat = cityCenter.lat;
        lng = cityCenter.lng;
      } else {
        return finish(
          fail(
            "OUTSIDE_COVERAGE",
            `Lo sentimos, solo operamos dentro de ${cityRadiusKm}km del centro de cobertura de tu ciudad.`,
            400
          ),
          400,
          { businessId }
        );
      }
    }

    await dbConnect();
    await runSubscriptionStatusJob();

    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    const recentByPhone = await Order.countDocuments({
      phoneHash,
      createdAt: { $gte: fiveMinutesAgo },
    });
    if (recentByPhone >= 5) {
      return finish(
        fail("RATE_LIMIT_PHONE", "Demasiados pedidos desde este telefono. Espera unos minutos.", 429),
        429,
        { phoneHash }
      );
    }

    const business = await Business.findOne({
      _id: new mongoose.Types.ObjectId(businessId),
      ...buildCityScopedFilter(selectedCity._id, { includeUnassigned: includeUnassignedBusiness }),
    }).lean();
    if (!business || !(business as any).isActive) {
      return finish(fail("BUSINESS_NOT_AVAILABLE", "Business is not available.", 404), 404, { businessId });
    }
    const businessTier = String((business as any)?.performance?.tier || "bronze").trim().toLowerCase();
    if (promoCodeRaw && businessTier === "probation") {
      return finish(
        fail("PROMO_NOT_ALLOWED", "Promos no disponibles para este negocio en este momento.", 409),
        409,
        { businessId, promoCode: promoCodeRaw }
      );
    }
    const subscription = computeSubscriptionStatus((business as any).subscription || {});
    if (subscription.status === "suspended") {
      return finish(fail("BUSINESS_SUSPENDED", "This business is temporarily suspended.", 403), 403, {
        businessId,
      });
    }
    const bLat = Number((business as any)?.location?.coordinates?.[1]);
    const bLng = Number((business as any)?.location?.coordinates?.[0]);
    if (!isBusinessWithinCityCoverage(selectedCity, bLat, bLng)) {
      return finish(fail("BUSINESS_OUTSIDE_CLUSTER", "Business is outside coverage cluster.", 400), 400, {
        businessId,
      });
    }
    const openStatus = isBusinessOpenNow(business as {
      paused?: boolean;
      isManuallyPaused?: boolean;
      busyUntil?: Date | string | null;
      hours?: {
        timezone?: string | null;
        weekly?: Record<string, unknown> | null;
      } | null;
    });
    if (!openStatus.open) {
      const reason = openStatus.reason || "closed";
      const nextOpenAt =
        openStatus.nextOpenAt && !Number.isNaN(new Date(openStatus.nextOpenAt).getTime())
          ? new Date(openStatus.nextOpenAt).toISOString()
          : null;
      const nextOpenText = String(openStatus.nextOpenText || "").trim() || null;
      const eventWeekKey = getWeekKey(new Date());
      try {
        await OpsEvent.create({
          type: "order_blocked",
          reason,
          weekKey: eventWeekKey,
          businessId: (business as any)._id,
          businessName: String((business as any).name || ""),
        });
      } catch {
        // no-op: do not block order response on observability write failure
      }
      const message =
        reason === "manual_pause"
          ? "Este negocio esta pausado temporalmente."
          : reason === "busy"
          ? "Este negocio esta en modo ocupado. Intenta mas tarde."
          : `Este negocio esta cerrado ahora.${nextOpenText ? ` Proxima apertura: ${nextOpenText}` : ""}`;
      return finish(
        fail("BUSINESS_CLOSED", message, 403, {
          reason,
          nextOpenAt,
          nextOpenText,
        }),
        403,
        { businessId, reason }
      );
    }
    const etaSnapshot = computeOrderEtaSnapshot((business as any).eta || null);
    const deliveryInfo = getPublicDeliveryInfo(
      business as { deliveryPolicy?: Record<string, unknown> }
    );

    const productIds = items.map((it) => new mongoose.Types.ObjectId(String(it.productId)));
    const products = await Product.find({
      _id: { $in: productIds },
      businessId,
      isAvailable: true,
    }).lean();
    const productMap = new Map(products.map((p: any) => [String(p._id), p]));
    if (productMap.size !== items.length) {
      return finish(fail("PRODUCTS_INVALID", "One or more products are unavailable.", 400), 400, {
        businessId,
      });
    }
    let deliveryFeeQuote: ReturnType<typeof computeDeliveryFeeForOrder>;
    try {
      deliveryFeeQuote = computeDeliveryFeeForOrder({
        city: selectedCity,
        customerLatLng: { lat, lng },
        businessLatLng: { lat: bLat, lng: bLng },
      });
    } catch (feeError: unknown) {
      const feeErr = feeError as Error & { code?: string; status?: number };
      return finish(
        fail(
          feeErr.code || "DELIVERY_FEE_OUT_OF_RANGE",
          feeErr.message || "No se pudo calcular la tarifa de entrega.",
          feeErr.status || 409
        ),
        feeErr.status || 409,
        { businessId }
      );
    }

    const orderItems = items.map((it) => {
      const p: any = productMap.get(String(it.productId));
      const qty = Math.max(1, Math.min(50, Number(it.qty)));
      const unitPrice = Number(p.price);
      const lineTotal = roundCurrency(unitPrice * qty);
      return {
        productId: p._id,
        name: p.name,
        productPrice: unitPrice,
        qty,
        unitPrice,
        lineTotal,
      };
    });

    const subtotalBefore = roundCurrency(orderItems.reduce((sum, line) => sum + line.lineTotal, 0));
    const weekKey = getWeekKey(new Date());
    let subtotalAfter = subtotalBefore;
    let discountAmount = 0;
    let discountSource: "promo" | "wallet" | null = null;
    let discountCode: string | null = null;
    let discountPromoId: mongoose.Types.ObjectId | null = null;
    let referralSnapshot: {
      usedCode?: string | null;
      referrerPhoneHash?: string | null;
      appliedNewCustomerBonus?: number | null;
    } = {
      usedCode: null,
      referrerPhoneHash: null,
      appliedNewCustomerBonus: null,
    };

    let customerDoc: CustomerLean | null = null;
    const getCustomer = async () => {
      if (customerDoc) return customerDoc;
      customerDoc = await Customer.findOneAndUpdate(
        { phoneHash },
        {
          $setOnInsert: {
            phoneHash,
            cityId: selectedCity._id,
          },
        },
        { upsert: true, returnDocument: "after" }
      ).lean<CustomerLean | null>();
      return customerDoc;
    };

    if (promoCodeRaw) {
      const promo = await Promo.findOne({ code: promoCodeRaw }).lean<PromoLean | null>();
      if (!promo) {
        return finish(fail("PROMO_INVALID", "Codigo promocional no valido.", 400), 400, {
          businessId,
          promoCode: promoCodeRaw,
        });
      }

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

      const promoResult = computePromoDiscount({
        promo,
        subtotal: subtotalBefore,
        businessId,
        phoneHash,
        now: new Date(),
        redemptionCountForPromo,
        redemptionCountForPhone,
      });
      if (promoResult.discountAmount <= 0) {
        return finish(fail("PROMO_INVALID", promoReasonToMessage(promoResult.reason), 400), 400, {
          businessId,
          promoCode: promoCodeRaw,
          reason: promoResult.reason,
        });
      }
      const discountCandidate = roundCurrency(promoResult.discountAmount);
      const promoPolicy = await getPromoPolicyForWeek(weekKey);
      if (!promoPolicy.promosEnabled) {
        return finish(
          fail("PROMOS_DISABLED", "Promos temporalmente deshabilitados.", 409),
          409,
          {
            businessId,
            promoCode: promoCodeRaw,
          }
        );
      }
      if (budgetBlocksDiscount(promoPolicy.remainingRdp, discountCandidate)) {
        return finish(
          fail("PROMO_BUDGET_EXCEEDED", "Promos temporalmente agotados. Intenta mas tarde.", 409),
          409,
          {
            businessId,
            promoCode: promoCodeRaw,
            weekKey,
          }
        );
      }

      discountSource = "promo";
      discountCode = promo.code;
      discountPromoId = promo._id;
      discountAmount = discountCandidate;
      subtotalAfter = roundCurrency(subtotalBefore - discountAmount);
    } else if (applyWalletCredit && REFERRALS_ENABLED) {
      const customer = await getCustomer();
      const walletCredit = roundCurrency(Number(customer?.walletCreditRdp || 0));
      if (walletCredit > 0) {
        discountSource = "wallet";
        discountAmount = roundCurrency(Math.min(walletCredit, subtotalBefore));
        subtotalAfter = roundCurrency(subtotalBefore - discountAmount);
      }
    }

    if (referralCodeRaw && REFERRALS_ENABLED) {
      const customer = await getCustomer();
      const isNewCustomer = Number(customer?.deliveredCount || 0) === 0 && !customer?.firstDeliveredAt;
      if (isNewCustomer) {
        const referrer = await Customer.findOne({ referralCode: referralCodeRaw }).lean<CustomerLean | null>();
        if (!referrer) {
          return finish(fail("VALIDATION_ERROR", "Codigo de referido invalido.", 400), 400, {
            referralCode: referralCodeRaw,
          });
        }
        if (referrer.phoneHash === phoneHash) {
          return finish(fail("VALIDATION_ERROR", "No puedes usar tu propio codigo.", 400), 400);
        }
        referralSnapshot = {
          usedCode: referralCodeRaw,
          referrerPhoneHash: referrer.phoneHash,
          appliedNewCustomerBonus: null,
        };
      }
    }

    const subtotal = subtotalAfter;
    const commissionRate = Number((business as any).commissionRate || COMMISSION_RATE_DEFAULT);
    const commissionAmount = roundCurrency(subtotalAfter * commissionRate);
    const deliveryFeeToCustomer = roundCurrency(Number(deliveryFeeQuote.fee || 0));
    const total = roundCurrency(subtotalAfter + deliveryFeeToCustomer);
    let created: any | null = null;
    let deliveryOtp = "";
    let deliveryOtpMessageEs = "";
    for (let attempt = 0; attempt < 5; attempt++) {
      const orderNumber = await generateUniqueOrderNumber();
      const otpCreatedAt = new Date();
      const orderOtp = deriveOrderOtp(orderNumber, otpCreatedAt);
      const otpHash = hashOtp(orderOtp);
      try {
        created = await Order.create({
          orderNumber,
          cityId: selectedCity._id,
          businessId: (business as any)._id,
          businessName: (business as any).name,
          businessType: (business as any).type,
          customerName,
          phone,
          phoneHash,
          address,
          customerLocation: { lat, lng },
          items: orderItems,
          subtotal,
          deliveryFeeToCustomer,
          total,
          commissionRate,
          commissionAmount,
          commissionRateAtOrderTime: commissionRate,
          currency: normalizeMoneyCurrency(selectedCity),
          deliveryFeeModelAtOrderTime: selectedCity.deliveryFeeModel,
          deliveryFeeBandAtOrderTime: deliveryFeeQuote.band
            ? {
                minKm: Number(deliveryFeeQuote.band.minKm || 0),
                maxKm: Number(deliveryFeeQuote.band.maxKm || 0),
                fee: Number(deliveryFeeQuote.band.fee || 0),
              }
            : null,
          riderPayoutExpectedAtOrderTime: Number(deliveryFeeQuote.payoutToRider || 0),
          payment: { method: "cash", status: "unpaid" },
          paymentStatus: "unpaid",
          status: "new",
          benefitsApplied: false,
          discount: {
            source: discountSource,
            code: discountCode,
            promoId: discountPromoId,
            amount: discountAmount,
            subtotalBefore,
            subtotalAfter,
          },
          referral: referralSnapshot,
          attribution: {
            source: orderSource,
            campaignId,
          },
          eta: {
            minMins: etaSnapshot.etaMinMins,
            maxMins: etaSnapshot.etaMaxMins,
            prepMins: etaSnapshot.etaPrepMins,
            text: etaSnapshot.etaText,
          },
          deliverySnapshot: {
            mode: deliveryInfo.mode,
            noteEs: deliveryInfo.publicNoteEs,
          },
          settlement: { weekKey, status: "pending", counted: false },
          deliveryProof: {
            required: true,
            otpHash,
            otpLast4: orderOtp.slice(-4),
            otpCreatedAt,
            verifiedAt: null,
            verifiedBy: null,
          },
        });
        deliveryOtp = orderOtp;
        deliveryOtpMessageEs =
          "Comparte este codigo con el mensajero solo cuando recibas tu pedido.";
        break;
      } catch (error: unknown) {
        if (isDuplicateKeyError(error) && attempt < 4) {
          continue;
        }
        throw error;
      }
    }

    if (!created) {
      return finish(fail("ORDER_NUMBER_CONFLICT", "Could not create order number. Please retry.", 500), 500, {
        businessId,
      });
    }

    return finish(
      ok(
        {
          orderId: String(created._id),
          orderNumber: created.orderNumber,
          status: created.status,
          businessId: String((business as any)._id),
          businessName: String((business as any).name || ""),
          business: {
            businessId: String((business as any)._id),
            businessName: String((business as any).name || ""),
            eta: {
              minMins: etaSnapshot.etaMinMins,
              maxMins: etaSnapshot.etaMaxMins,
              prepMins: etaSnapshot.etaPrepMins,
              text: etaSnapshot.etaText,
            },
            trust: {
              badge: trustBadgeFromTier(String((business as any)?.performance?.tier || "bronze")),
            },
            delivery: {
              mode: deliveryInfo.mode,
              noteEs: deliveryInfo.publicNoteEs,
            },
          },
          order: {
            orderId: String(created._id),
            orderNumber: created.orderNumber,
            status: created.status,
            statusLabelEs: statusLabelEs("new"),
            eta: {
              minMins: etaSnapshot.etaMinMins,
              maxMins: etaSnapshot.etaMaxMins,
              prepMins: etaSnapshot.etaPrepMins,
              text: etaSnapshot.etaText,
            },
            delivery: {
              mode: deliveryInfo.mode,
              noteEs: deliveryInfo.publicNoteEs,
            },
          },
          delivery: {
            mode: deliveryInfo.mode,
            noteEs: deliveryInfo.publicNoteEs,
          },
          payment: { method: "cash", status: "unpaid" },
          contact: {
            whatsapp: String((business as any).whatsapp || ""),
            phone: String((business as any).phone || ""),
            businessName: String((business as any).name || ""),
          },
          support: {
            whatsapp: SUPPORT_WHATSAPP_E164,
            defaultText: SUPPORT_WHATSAPP_DEFAULT_TEXT,
            deliveryDisclaimerEs: DELIVERY_DISCLAIMER_ES,
          },
          totals: {
            subtotalBefore,
            discountAmount,
            subtotalAfter,
            subtotal,
            deliveryFeeToCustomer,
            total,
            commissionAmount,
            currency: normalizeMoneyCurrency(selectedCity),
            deliveryFeeModel: selectedCity.deliveryFeeModel,
          },
          appliedPromoCode: discountSource === "promo" ? discountCode : null,
          attribution: {
            source: orderSource,
            campaignId,
          },
          deliveryOtp,
          messageEs: deliveryOtpMessageEs,
          deliveryOtpMessageEs,
          deliveryProof: {
            required: true,
            otpLast4: deliveryOtp.slice(-4),
            verifiedAt: null,
            instructionsEs: "Comparte tu codigo con el repartidor para confirmar entrega.",
          },
        },
        201
      ),
      201,
      {
        businessId,
        orderNumber: created.orderNumber,
      }
    );
  } catch (error: unknown) {
    const err = error as Error & { status?: number; code?: string };
    const status = err.status || 500;
    return finish(fail(err.code || "SERVER_ERROR", err.message || "Could not create order.", status), status, {
      error: err.message || "Could not create order.",
    });
  }
}

