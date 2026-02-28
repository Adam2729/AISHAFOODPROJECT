import crypto from "crypto";
import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { ok, fail } from "@/lib/apiResponse";
import { assertNotInMaintenance } from "@/lib/maintenance";
import { haversineDistanceKm } from "@/lib/geo";
import { isBusinessOpenNow } from "@/lib/businessHours";
import { computeSubscriptionStatus } from "@/lib/subscription";
import { computeOrderEtaSnapshot } from "@/lib/eta";
import { computeTrustBadge } from "@/lib/trustBadge";
import { buildBusinessRank, compareBusinessRank, compareProductRank } from "@/lib/searchRank";
import {
  buildCityScopedFilter,
  getCityCenter,
  getDefaultCity,
  isBusinessWithinCityCoverage,
  isDefaultCity,
  requireActiveCity,
  resolveCityFromRequest,
} from "@/lib/city";
import { getBoolSetting, getStringSetting } from "@/lib/appSettings";
import { normalizePhone as normalizePilotPhone, parseAllowlist } from "@/lib/pilot";
import { Business } from "@/models/Business";
import { Product } from "@/models/Product";
import { Order } from "@/models/Order";
import { Complaint } from "@/models/Complaint";
import { SearchEvent } from "@/models/SearchEvent";

type ApiError = Error & { status?: number; code?: string };

type SearchSource = "home" | "searchbar" | "buyagain" | "favorites" | "reorder" | "unknown";
const ALLOWED_SOURCES = new Set<SearchSource>([
  "home",
  "searchbar",
  "buyagain",
  "favorites",
  "reorder",
  "unknown",
]);

type TrustAggOrder = {
  _id: mongoose.Types.ObjectId;
  deliveredCount30d: number;
  acceptedCount30d: number;
  acceptedWithin7mCount30d: number;
};

type TrustAggComplaint = {
  _id: mongoose.Types.ObjectId;
  complaintsCount30d: number;
};

type BusinessLean = {
  _id: mongoose.Types.ObjectId;
  name?: string;
  type?: string;
  logoUrl?: string;
  address?: string;
  paused?: boolean;
  isActive?: boolean;
  isManuallyPaused?: boolean;
  busyUntil?: Date | null;
  hours?: {
    timezone?: string | null;
    weekly?: Record<string, unknown> | null;
  } | null;
  location?: {
    coordinates?: [number, number];
  };
  subscription?: {
    trialEndsAt?: Date | string | null;
    paidUntilAt?: Date | string | null;
    graceDays?: number | null;
  };
  eta?: {
    minMins?: number;
    maxMins?: number;
    prepMins?: number;
  };
  menuQuality?: {
    score?: number;
  };
  score?: number;
};

type ProductLean = {
  _id: mongoose.Types.ObjectId;
  businessId: mongoose.Types.ObjectId;
  name?: string;
  category?: string;
  price?: number;
  imageUrl?: string;
  score?: number;
};

function toNumber(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function parseCoord(value: string | null) {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeQuery(raw: string) {
  return String(raw || "").replace(/\s+/g, " ").trim();
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeSource(raw: string): SearchSource {
  const source = String(raw || "").trim().toLowerCase() as SearchSource;
  return ALLOWED_SOURCES.has(source) ? source : "unknown";
}

function queryHash(qNorm: string) {
  return crypto.createHash("sha256").update(String(qNorm || "").toLowerCase()).digest("hex");
}

function normalizeLimit(raw: string | null, defaultValue: number, min: number, max: number) {
  const parsed = Number(raw || defaultValue);
  if (!Number.isFinite(parsed)) return defaultValue;
  return clamp(Math.floor(parsed), min, max);
}

function hasQueryText(q: string) {
  return /[a-z0-9\u00c0-\u024f]/i.test(q);
}

async function getTrustMap(businessIds: mongoose.Types.ObjectId[]) {
  const trust = new Map<
    string,
    {
      badge: "top" | "good" | "new" | "at_risk";
      delivered30d: number;
      acceptanceWithin7mRate30d: number;
      complaints30d: number;
    }
  >();
  if (!businessIds.length) return trust;

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const [ordersAgg, complaintsAgg] = await Promise.all([
    Order.aggregate<TrustAggOrder>([
      {
        $match: {
          status: "delivered",
          createdAt: { $gte: thirtyDaysAgo },
          businessId: { $in: businessIds },
        },
      },
      {
        $project: {
          businessId: 1,
          acceptanceMinutes: {
            $cond: [
              {
                $and: [
                  { $eq: [{ $type: "$statusTimestamps.acceptedAt" }, "date"] },
                  { $eq: [{ $type: "$createdAt" }, "date"] },
                ],
              },
              {
                $max: [
                  0,
                  {
                    $divide: [
                      { $subtract: ["$statusTimestamps.acceptedAt", "$createdAt"] },
                      60000,
                    ],
                  },
                ],
              },
              null,
            ],
          },
        },
      },
      {
        $group: {
          _id: "$businessId",
          deliveredCount30d: { $sum: 1 },
          acceptedCount30d: {
            $sum: { $cond: [{ $ne: ["$acceptanceMinutes", null] }, 1, 0] },
          },
          acceptedWithin7mCount30d: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $ne: ["$acceptanceMinutes", null] },
                    { $lte: ["$acceptanceMinutes", 7] },
                  ],
                },
                1,
                0,
              ],
            },
          },
        },
      },
    ]),
    Complaint.aggregate<TrustAggComplaint>([
      {
        $match: {
          createdAt: { $gte: thirtyDaysAgo },
          businessId: { $in: businessIds },
        },
      },
      {
        $group: {
          _id: "$businessId",
          complaintsCount30d: { $sum: 1 },
        },
      },
    ]),
  ]);

  const complaintsMap = new Map(complaintsAgg.map((row) => [String(row._id), row]));
  for (const row of ordersAgg) {
    const delivered30d = Math.max(0, toNumber(row.deliveredCount30d));
    const acceptedCount30d = Math.max(0, toNumber(row.acceptedCount30d));
    const acceptedWithin7mCount30d = Math.max(0, toNumber(row.acceptedWithin7mCount30d));
    const acceptanceWithin7mRate30d =
      acceptedCount30d > 0 ? acceptedWithin7mCount30d / acceptedCount30d : 0;
    const complaints30d = Math.max(
      0,
      toNumber(complaintsMap.get(String(row._id))?.complaintsCount30d)
    );
    trust.set(String(row._id), {
      badge: computeTrustBadge({
        delivered30d,
        complaints30d,
        acceptanceWithin7mRate30d,
      }).badge,
      delivered30d,
      acceptanceWithin7mRate30d: Number(acceptanceWithin7mRate30d.toFixed(2)),
      complaints30d,
    });
  }

  for (const businessId of businessIds) {
    const key = String(businessId);
    if (trust.has(key)) continue;
    trust.set(key, {
      badge: computeTrustBadge({
        delivered30d: 0,
        complaints30d: Math.max(0, toNumber(complaintsMap.get(key)?.complaintsCount30d)),
        acceptanceWithin7mRate30d: 0,
      }).badge,
      delivered30d: 0,
      acceptanceWithin7mRate30d: 0,
      complaints30d: Math.max(0, toNumber(complaintsMap.get(key)?.complaintsCount30d)),
    });
  }

  return trust;
}

function businessEligible(
  business: BusinessLean,
  pilotAllowed: boolean,
  selectedCity: {
    maxDeliveryRadiusKm: number;
    coverageCenterLat: number;
    coverageCenterLng: number;
  }
) {
  if (!pilotAllowed) return false;
  if (!business?.isActive || business?.paused) return false;
  const coordinates = business?.location?.coordinates || [];
  const lng = Number(coordinates?.[0]);
  const lat = Number(coordinates?.[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (!isBusinessWithinCityCoverage(selectedCity, lat, lng)) {
    return false;
  }
  const subscription = computeSubscriptionStatus(business.subscription || {});
  return subscription.status !== "suspended";
}

async function isPilotPermitted(phoneRaw: string) {
  const [pilotMode, allowlistEnabled, allowlistRaw] = await Promise.all([
    getBoolSetting("pilot_mode", false),
    getBoolSetting("pilot_allowlist_enabled", true),
    getStringSetting("pilot_allowlist_phones", ""),
  ]);
  if (!pilotMode || !allowlistEnabled) return true;

  const normalized = normalizePilotPhone(phoneRaw);
  if (!normalized.digits) return false;
  const allowlist = parseAllowlist(allowlistRaw);
  const allowlistLast10 = new Set(Array.from(allowlist).map((entry) => entry.slice(-10)));
  return (
    allowlist.has(normalized.digits) ||
    allowlist.has(normalized.last10) ||
    allowlistLast10.has(normalized.last10)
  );
}

export async function GET(req: Request) {
  const startedAt = Date.now();
  try {
    await assertNotInMaintenance();
    const url = new URL(req.url);
    const qRaw = String(url.searchParams.get("q") || "");
    const qNorm = normalizeQuery(qRaw);
    if (qNorm.length < 2 || qNorm.length > 60) {
      return fail("VALIDATION_ERROR", "q must be between 2 and 60 chars.", 400);
    }
    if (!hasQueryText(qNorm)) {
      return fail("VALIDATION_ERROR", "q must include letters or numbers.", 400);
    }

    const lat = parseCoord(url.searchParams.get("lat"));
    const lng = parseCoord(url.searchParams.get("lng"));
    const limitBusinesses = normalizeLimit(url.searchParams.get("limitBusinesses"), 10, 1, 20);
    const limitProducts = normalizeLimit(url.searchParams.get("limitProducts"), 20, 1, 50);
    const source = normalizeSource(String(url.searchParams.get("source") || "unknown"));
    const phone = String(url.searchParams.get("phone") || "").trim();
    const qHash = queryHash(qNorm);
    const pilotAllowed = await isPilotPermitted(phone);
    const selectedCity = await resolveCityFromRequest(req);
    requireActiveCity(selectedCity);
    const defaultCity = await getDefaultCity();
    const includeUnassigned = isDefaultCity(selectedCity, defaultCity._id);
    const cityScopedFilter = buildCityScopedFilter(selectedCity._id, { includeUnassigned });
    const cityCenter = getCityCenter(selectedCity);
    const sortLat = lat ?? cityCenter.lat;
    const sortLng = lng ?? cityCenter.lng;

    await dbConnect();

    const useText = qNorm.length >= 3;
    const escaped = escapeRegex(qNorm);
    const businessProjection = useText ? { score: { $meta: "textScore" as const } } : undefined;
    let businessCandidates: BusinessLean[] = [];

    if (useText) {
      try {
        businessCandidates = await Business.find(
          {
            ...cityScopedFilter,
            $text: { $search: qNorm },
          },
          businessProjection
        )
          .select(
            "name type logoUrl address isActive paused isManuallyPaused busyUntil hours location subscription eta menuQuality score"
          )
          .sort({ score: { $meta: "textScore" } })
          .limit(60)
          .lean<BusinessLean[]>();
      } catch {
        businessCandidates = [];
      }
    }
    if (!businessCandidates.length) {
      businessCandidates = await Business.find({
        ...cityScopedFilter,
        name: { $regex: escaped, $options: "i" },
      })
        .select(
          "name type logoUrl address isActive paused isManuallyPaused busyUntil hours location subscription eta menuQuality"
        )
        .limit(60)
        .lean<BusinessLean[]>();
    }

    const eligibleBusinessCandidates = businessCandidates.filter((business) =>
      businessEligible(business, pilotAllowed, selectedCity)
    );
    const trustMap = await getTrustMap(
      eligibleBusinessCandidates.map((row) => new mongoose.Types.ObjectId(row._id))
    );

    const rankedBusinesses = eligibleBusinessCandidates
      .map((business) => {
        const coords = business.location?.coordinates || [];
        const businessLng = Number(coords[0]);
        const businessLat = Number(coords[1]);
        const openStatus = isBusinessOpenNow(business);
        const trust = trustMap.get(String(business._id)) || {
          badge: "new" as const,
          delivered30d: 0,
          acceptanceWithin7mRate30d: 0,
          complaints30d: 0,
        };
        const menuQualityScore = Math.max(0, toNumber(business.menuQuality?.score));
        const eta = computeOrderEtaSnapshot(business.eta || null);
        const rank = buildBusinessRank({
          isOpenNow: Boolean(openStatus.open),
          trustBadge: trust.badge,
          menuQualityScore,
          distanceKm: haversineDistanceKm(sortLat, sortLng, businessLat, businessLng),
          textScore: toNumber((business as { score?: number }).score, 0),
        });

        return {
          businessId: String(business._id),
          name: String(business.name || "Business"),
          type: String(business.type || "restaurant"),
          logoUrl: String(business.logoUrl || ""),
          eta: {
            minMins: eta.etaMinMins,
            maxMins: eta.etaMaxMins,
            prepMins: eta.etaPrepMins,
            text: eta.etaText,
          },
          trust: {
            badge: trust.badge,
            delivered30d: trust.delivered30d,
            acceptanceWithin7mRate30d: trust.acceptanceWithin7mRate30d,
            complaints30d: trust.complaints30d,
          },
          menuQualityScore: Math.round(menuQualityScore),
          isOpenNow: Boolean(openStatus.open),
          closedReason: openStatus.open ? null : openStatus.reason || null,
          nextOpenText: openStatus.open ? null : openStatus.nextOpenText || null,
          distanceKm: Number(rank.distanceKm.toFixed(3)),
          rank,
        };
      })
      .sort((a, b) => compareBusinessRank(a, b));

    const businessResults = rankedBusinesses.slice(0, limitBusinesses).map((row) => ({
      businessId: row.businessId,
      name: row.name,
      type: row.type,
      logoUrl: row.logoUrl,
      eta: row.eta,
      trust: row.trust,
      menuQualityScore: row.menuQualityScore,
      isOpenNow: row.isOpenNow,
      closedReason: row.closedReason,
      nextOpenText: row.nextOpenText,
      distanceKm: row.distanceKm,
    }));

    const productProjection = useText ? { score: { $meta: "textScore" as const } } : undefined;
    let productCandidates: ProductLean[] = [];
    if (useText) {
      try {
        productCandidates = await Product.find(
          {
            isAvailable: true,
            $text: { $search: qNorm },
          },
          productProjection
        )
          .select("businessId name category price imageUrl score")
          .sort({ score: { $meta: "textScore" } })
          .limit(80)
          .lean<ProductLean[]>();
      } catch {
        productCandidates = [];
      }
    }
    if (!productCandidates.length) {
      productCandidates = await Product.find({
        isAvailable: true,
        $or: [
          { name: { $regex: escaped, $options: "i" } },
          { category: { $regex: escaped, $options: "i" } },
        ],
      })
        .select("businessId name category price imageUrl")
        .limit(80)
        .lean<ProductLean[]>();
    }

    const productBusinessIds = Array.from(
      new Set(productCandidates.map((row) => String(row.businessId)))
    )
      .filter((id) => mongoose.Types.ObjectId.isValid(id))
      .map((id) => new mongoose.Types.ObjectId(id));
    const productBusinesses = await Business.find({ _id: { $in: productBusinessIds } })
      .find(cityScopedFilter)
      .select(
        "name type isActive paused isManuallyPaused busyUntil hours location subscription eta menuQuality"
      )
      .lean<BusinessLean[]>();
    const eligibleProductBusinesses = productBusinesses.filter((business) =>
      businessEligible(business, pilotAllowed, selectedCity)
    );
    const productBusinessMap = new Map(
      eligibleProductBusinesses.map((business) => [String(business._id), business])
    );
    const productTrustMap = await getTrustMap(
      eligibleProductBusinesses.map((row) => new mongoose.Types.ObjectId(row._id))
    );

    const rankedProducts = productCandidates
      .map((product) => {
        const business = productBusinessMap.get(String(product.businessId));
        if (!business) return null;
        const coords = business.location?.coordinates || [];
        const businessLng = Number(coords[0]);
        const businessLat = Number(coords[1]);
        const openStatus = isBusinessOpenNow(business);
        const trust = productTrustMap.get(String(business._id)) || {
          badge: "new" as const,
          delivered30d: 0,
          acceptanceWithin7mRate30d: 0,
          complaints30d: 0,
        };
        const menuQualityScore = Math.max(0, toNumber(business.menuQuality?.score));
        const eta = computeOrderEtaSnapshot(business.eta || null);
        const rank = buildBusinessRank({
          isOpenNow: Boolean(openStatus.open),
          trustBadge: trust.badge,
          menuQualityScore,
          distanceKm: haversineDistanceKm(sortLat, sortLng, businessLat, businessLng),
          textScore: toNumber((product as { score?: number }).score, 0),
        });

        return {
          productId: String(product._id),
          name: String(product.name || "Producto"),
          category: String(product.category || ""),
          price: Math.max(0, toNumber(product.price)),
          imageUrl: String(product.imageUrl || ""),
          businessId: String(business._id),
          businessName: String(business.name || "Business"),
          businessType: String(business.type || "restaurant"),
          businessEta: {
            minMins: eta.etaMinMins,
            maxMins: eta.etaMaxMins,
            prepMins: eta.etaPrepMins,
            text: eta.etaText,
          },
          businessTrust: {
            badge: trust.badge,
          },
          businessMenuQualityScore: Math.round(menuQualityScore),
          isOpenNow: Boolean(openStatus.open),
          distanceKm: Number(rank.distanceKm.toFixed(3)),
          rank,
        };
      })
      .filter(Boolean) as Array<{
      productId: string;
      name: string;
      category: string;
      price: number;
      imageUrl: string;
      businessId: string;
      businessName: string;
      businessType: string;
      businessEta: { minMins: number; maxMins: number; prepMins: number; text: string };
      businessTrust: { badge: string };
      businessMenuQualityScore: number;
      isOpenNow: boolean;
      distanceKm: number;
      rank: ReturnType<typeof buildBusinessRank>;
    }>;

    rankedProducts.sort((a, b) => compareProductRank(a, b));
    const productResults = rankedProducts.slice(0, limitProducts).map((row) => ({
      productId: row.productId,
      name: row.name,
      category: row.category,
      price: row.price,
      imageUrl: row.imageUrl,
      businessId: row.businessId,
      businessName: row.businessName,
      businessType: row.businessType,
      businessEta: row.businessEta,
      businessTrust: row.businessTrust,
      businessMenuQualityScore: row.businessMenuQualityScore,
      isOpenNow: row.isOpenNow,
      distanceKm: row.distanceKm,
    }));

    const topBusinessIds = Array.from(
      new Set(productResults.map((row) => row.businessId))
    )
      .slice(0, 5)
      .filter((id) => mongoose.Types.ObjectId.isValid(id))
      .map((id) => new mongoose.Types.ObjectId(id));

    SearchEvent.create({
      queryHash: qHash,
      qLen: qNorm.length,
      source,
      resultsBusinesses: businessResults.length,
      resultsProducts: productResults.length,
      zeroResults: businessResults.length + productResults.length === 0,
      env: process.env.NODE_ENV || "development",
      topBusinessIds,
    }).catch(() => undefined);

    const tookMs = Date.now() - startedAt;
    return ok({
      q: qRaw,
      qNorm,
      results: {
        businesses: businessResults,
        products: productResults,
      },
      meta: {
        tookMs,
        counts: {
          businessCandidates: rankedBusinesses.length,
          productCandidates: rankedProducts.length,
          businessesReturned: businessResults.length,
          productsReturned: productResults.length,
        },
      },
    });
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(err.code || "SERVER_ERROR", err.message || "Could not run search.", err.status || 500);
  }
}
