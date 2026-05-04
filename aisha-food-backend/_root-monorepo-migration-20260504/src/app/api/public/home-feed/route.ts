import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { ok, fail } from "@/lib/apiResponse";
import { assertNotInMaintenance } from "@/lib/maintenance";
import { BASE_LOCATION, MAX_RADIUS_KM } from "@/lib/constants";
import { haversineDistanceKm, isWithinRadiusKm } from "@/lib/geo";
import { isBusinessOpenNow } from "@/lib/businessHours";
import { computeSubscriptionStatus } from "@/lib/subscription";
import { computeOrderEtaSnapshot } from "@/lib/eta";
import { computeTrustBadge } from "@/lib/trustBadge";
import {
  buildBusinessRank,
  compareBusinessRank,
  compareProductRank,
  trustRank,
} from "@/lib/searchRank";
import { normalizePhone, phoneToHash } from "@/lib/phoneHash";
import { Business } from "@/models/Business";
import { Order } from "@/models/Order";
import { Product } from "@/models/Product";
import { Complaint } from "@/models/Complaint";
import { Favorite } from "@/models/Favorite";

type ApiError = Error & { status?: number; code?: string };

type BusinessLean = {
  _id: mongoose.Types.ObjectId;
  name?: string;
  type?: string;
  logoUrl?: string;
  address?: string;
  isActive?: boolean;
  paused?: boolean;
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
};

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

type BusinessTrendAgg = {
  _id: mongoose.Types.ObjectId;
  deliveredCount: number;
};

type ProductTrendAgg = {
  _id: {
    productId: mongoose.Types.ObjectId;
    businessId: mongoose.Types.ObjectId;
  };
  itemCount: number;
};

type ProductLean = {
  _id: mongoose.Types.ObjectId;
  businessId: mongoose.Types.ObjectId;
  name?: string;
  category?: string;
  price?: number;
  imageUrl?: string;
  isAvailable?: boolean;
};

function toNumber(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseCoord(value: string | null) {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function businessEligible(business: BusinessLean) {
  if (!business?.isActive || business?.paused) return false;
  const coordinates = business?.location?.coordinates || [];
  const lng = Number(coordinates?.[0]);
  const lat = Number(coordinates?.[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (!isWithinRadiusKm(BASE_LOCATION.lat, BASE_LOCATION.lng, lat, lng, MAX_RADIUS_KM)) {
    return false;
  }
  const subscription = computeSubscriptionStatus(business.subscription || {});
  return subscription.status !== "suspended";
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
      badge: "new",
      delivered30d: 0,
      acceptanceWithin7mRate30d: 0,
      complaints30d: Math.max(0, toNumber(complaintsMap.get(key)?.complaintsCount30d)),
    });
  }
  return trust;
}

export async function GET(req: Request) {
  try {
    await assertNotInMaintenance();
    const url = new URL(req.url);
    const lat = parseCoord(url.searchParams.get("lat"));
    const lng = parseCoord(url.searchParams.get("lng"));
    const sortLat = lat ?? BASE_LOCATION.lat;
    const sortLng = lng ?? BASE_LOCATION.lng;
    const phoneRaw = String(url.searchParams.get("phone") || "").trim();
    const normalizedPhone = normalizePhone(phoneRaw);
    const phoneHash = normalizedPhone ? phoneToHash(normalizedPhone) : "";

    await dbConnect();

    const businessesRaw = await Business.find({
      isActive: true,
    })
      .select(
        "name type logoUrl address isActive paused isManuallyPaused busyUntil hours location subscription eta menuQuality"
      )
      .lean<BusinessLean[]>();
    const businesses = businessesRaw.filter(businessEligible);
    const businessIds = businesses.map((row) => new mongoose.Types.ObjectId(row._id));
    const trustMap = await getTrustMap(businessIds);

    const favorites = phoneHash
      ? await Favorite.find({ phoneHash, businessId: { $in: businessIds } })
          .select("businessId")
          .lean()
      : [];
    const favoriteSet = new Set(favorites.map((row) => String(row.businessId)));

    const rankedBusinesses = businesses
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
        });

        return {
          businessId: String(business._id),
          name: String(business.name || "Business"),
          type: String(business.type || "restaurant"),
          logoUrl: String(business.logoUrl || ""),
          address: String(business.address || ""),
          eta: {
            minMins: eta.etaMinMins,
            maxMins: eta.etaMaxMins,
            prepMins: eta.etaPrepMins,
            text: eta.etaText,
          },
          trust: {
            badge: trust.badge,
          },
          menuQualityScore: Math.round(menuQualityScore),
          isOpenNow: Boolean(openStatus.open),
          closedReason: openStatus.open ? null : openStatus.reason || null,
          nextOpenText: openStatus.open ? null : openStatus.nextOpenText || null,
          distanceKm: Number(rank.distanceKm.toFixed(3)),
          isFavorite: favoriteSet.has(String(business._id)),
          rank,
        };
      })
      .sort((a, b) => compareBusinessRank(a, b));

    const openNow = rankedBusinesses.filter((row) => row.isOpenNow).slice(0, 12);
    const top = rankedBusinesses
      .filter((row) => trustRank(row.trust.badge) >= 2)
      .slice(0, 12);

    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const [businessTrendAgg, productTrendAgg] = await Promise.all([
      Order.aggregate<BusinessTrendAgg>([
        {
          $match: {
            status: "delivered",
            createdAt: { $gte: since },
            businessId: { $in: businessIds },
          },
        },
        {
          $group: {
            _id: "$businessId",
            deliveredCount: { $sum: 1 },
          },
        },
      ]),
      Order.aggregate<ProductTrendAgg>([
        {
          $match: {
            status: "delivered",
            createdAt: { $gte: since },
            businessId: { $in: businessIds },
          },
        },
        { $unwind: "$items" },
        {
          $group: {
            _id: {
              productId: "$items.productId",
              businessId: "$businessId",
            },
            itemCount: { $sum: { $ifNull: ["$items.qty", 0] } },
          },
        },
      ]),
    ]);
    const businessTrendMap = new Map(
      businessTrendAgg.map((row) => [String(row._id), Math.max(0, toNumber(row.deliveredCount))])
    );

    const trendingBusinesses = rankedBusinesses
      .map((row) => ({
        ...row,
        deliveredCount: businessTrendMap.get(row.businessId) || 0,
      }))
      .filter((row) => row.deliveredCount > 0)
      .sort((a, b) => {
        if (a.deliveredCount !== b.deliveredCount) {
          return b.deliveredCount - a.deliveredCount;
        }
        return compareBusinessRank(a, b);
      })
      .slice(0, 10)
      .map((row) => ({
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
        isFavorite: row.isFavorite,
        deliveredCount: row.deliveredCount,
      }));

    const trendingProductIds = productTrendAgg.map((row) => row._id.productId);
    const trendingProductsDocs = await Product.find({
      _id: { $in: trendingProductIds },
      isAvailable: true,
    })
      .select("businessId name category price imageUrl isAvailable")
      .lean<ProductLean[]>();
    const trendingProductDocMap = new Map(
      trendingProductsDocs.map((row) => [String(row._id), row])
    );

    const trendingProducts = productTrendAgg
      .map((row) => {
        const product = trendingProductDocMap.get(String(row._id.productId));
        if (!product) return null;
        const business = rankedBusinesses.find((entry) => entry.businessId === String(row._id.businessId));
        if (!business) return null;
        return {
          productId: String(product._id),
          name: String(product.name || "Producto"),
          category: String(product.category || ""),
          price: Math.max(0, toNumber(product.price)),
          imageUrl: String(product.imageUrl || ""),
          itemCount: Math.max(0, toNumber(row.itemCount)),
          businessId: business.businessId,
          businessName: business.name,
          businessType: business.type,
          businessEta: business.eta,
          businessTrust: business.trust,
          businessMenuQualityScore: business.menuQualityScore,
          isOpenNow: business.isOpenNow,
          distanceKm: business.distanceKm,
          rank: buildBusinessRank({
            isOpenNow: business.isOpenNow,
            trustBadge: business.trust.badge,
            menuQualityScore: business.menuQualityScore,
            distanceKm: business.distanceKm,
            textScore: Math.max(0, toNumber(row.itemCount)),
          }),
        };
      })
      .filter(Boolean) as Array<{
      productId: string;
      name: string;
      category: string;
      price: number;
      imageUrl: string;
      itemCount: number;
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

    trendingProducts.sort((a, b) => {
      if (a.itemCount !== b.itemCount) return b.itemCount - a.itemCount;
      return compareProductRank(a, b);
    });

    return ok({
      openNow,
      top,
      trending: {
        businesses: trendingBusinesses,
        products: trendingProducts.slice(0, 16).map((row) => ({
          productId: row.productId,
          name: row.name,
          category: row.category,
          price: row.price,
          imageUrl: row.imageUrl,
          itemCount: row.itemCount,
          businessId: row.businessId,
          businessName: row.businessName,
          businessType: row.businessType,
          businessEta: row.businessEta,
          businessTrust: row.businessTrust,
          businessMenuQualityScore: row.businessMenuQualityScore,
          isOpenNow: row.isOpenNow,
          distanceKm: row.distanceKm,
        })),
      },
      meta: {
        generatedAt: new Date().toISOString(),
      },
    });
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(err.code || "SERVER_ERROR", err.message || "Could not load home feed.", err.status || 500);
  }
}
