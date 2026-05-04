/* eslint-disable @typescript-eslint/no-explicit-any */
import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { ok, fail } from "@/lib/apiResponse";
import { haversineDistanceKm } from "@/lib/geo";
import { isBusinessOpenNow } from "@/lib/businessHours";
import { computeSubscriptionStatus } from "@/lib/subscription";
import { runSubscriptionStatusJob } from "@/lib/subscriptionJob";
import { normalizePhone, phoneToHash } from "@/lib/phoneHash";
import { computeOrderEtaSnapshot } from "@/lib/eta";
import { computeTrustBadge } from "@/lib/trustBadge";
import { getPublicDeliveryInfo } from "@/lib/deliveryPolicy";
import {
  buildCityScopedFilter,
  getCityCenter,
  getDefaultCity,
  isBusinessWithinCityCoverage,
  isDefaultCity,
  isWithinCityCoverage,
  requireActiveCity,
  resolveCityFromRequest,
} from "@/lib/city";
import { Business } from "@/models/Business";
import { Favorite } from "@/models/Favorite";
import { Order } from "@/models/Order";
import { Complaint } from "@/models/Complaint";
import { Review } from "@/models/Review";

function parseCoord(value: string | null) {
  if (!value) return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return n;
}

function parseIds(value: string | null) {
  if (!value) return [];
  return value
    .split(",")
    .map((part) => String(part || "").trim())
    .filter(Boolean);
}

type Tier = "gold" | "silver" | "bronze" | "probation";
const TIER_RANK: Record<Tier, number> = {
  gold: 0,
  silver: 1,
  bronze: 2,
  probation: 3,
};

function normalizeTier(value: unknown): Tier {
  const tier = String(value || "").trim().toLowerCase();
  if (tier === "gold" || tier === "silver" || tier === "bronze" || tier === "probation") {
    return tier;
  }
  return "bronze";
}

type OrderTrustAgg = {
  _id: mongoose.Types.ObjectId;
  deliveredCount30d: number;
  acceptedCount30d: number;
  acceptedWithin7mCount30d: number;
};

type ComplaintTrustAgg = {
  _id: mongoose.Types.ObjectId;
  complaintsCount30d: number;
};

type ReviewReputationAgg = {
  _id: mongoose.Types.ObjectId;
  avgRating30d: number;
  reviewsCount30d: number;
};

function toNumber(value: unknown) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const lat = parseCoord(url.searchParams.get("lat"));
    const lng = parseCoord(url.searchParams.get("lng"));
    const phoneRaw = String(url.searchParams.get("phone") || "").trim();
    const ids = parseIds(url.searchParams.get("ids"));
    if ((lat === null) !== (lng === null)) {
      return fail("INVALID_COORDS", "Provide both lat and lng or omit both.");
    }
    if (ids.length > 50) {
      return fail("VALIDATION_ERROR", "ids supports up to 50 businesses.", 400);
    }
    const hasInvalidId = ids.some((id) => !/^[a-fA-F0-9]{24}$/.test(id));
    if (hasInvalidId) {
      return fail("VALIDATION_ERROR", "Invalid ids filter.", 400);
    }
    const normalizedPhone = phoneRaw ? normalizePhone(phoneRaw) : "";
    if (phoneRaw && !normalizedPhone) {
      return fail("VALIDATION_ERROR", "Invalid phone.", 400);
    }
    const phoneHash = normalizedPhone ? phoneToHash(normalizedPhone) : "";

    const selectedCity = await resolveCityFromRequest(req);
    requireActiveCity(selectedCity);
    const defaultCity = await getDefaultCity();
    const includeUnassigned = isDefaultCity(selectedCity, defaultCity._id);
    const cityCenter = getCityCenter(selectedCity);
    const cityRadiusKm = Number(selectedCity.maxDeliveryRadiusKm || 0) > 0
      ? Number(selectedCity.maxDeliveryRadiusKm)
      : 8;

    await dbConnect();
    await runSubscriptionStatusJob();
    const businessFilter: Record<string, unknown> = {
      isActive: true,
      ...buildCityScopedFilter(selectedCity._id, { includeUnassigned }),
    };
    if (ids.length) {
      businessFilter._id = { $in: ids.map((id) => new mongoose.Types.ObjectId(id)) };
    }

    const rawBusinesses = await Business.find(businessFilter)
      .select(
        "name phone whatsapp address logoUrl location type isActive subscription performance paused isManuallyPaused busyUntil hours eta deliveryPolicy"
      )
      .sort({ createdAt: -1 })
      .lean();

    const favoriteBusinessIds = phoneHash
      ? await Favorite.find({
          phoneHash,
          businessId: { $in: rawBusinesses.map((row) => row._id) },
        })
          .select("businessId")
          .lean()
      : [];
    const favoriteSet = new Set(favoriteBusinessIds.map((row) => String(row.businessId)));

    const trustedBusinessIds = rawBusinesses.map((row) => row._id as mongoose.Types.ObjectId);
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const [orderTrustAgg, complaintTrustAgg, reviewReputationAgg] = trustedBusinessIds.length
      ? await Promise.all([
          Order.aggregate<OrderTrustAgg>([
            {
              $match: {
                status: "delivered",
                createdAt: { $gte: thirtyDaysAgo },
                businessId: { $in: trustedBusinessIds },
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
          Complaint.aggregate<ComplaintTrustAgg>([
            {
              $match: {
                createdAt: { $gte: thirtyDaysAgo },
                businessId: { $in: trustedBusinessIds },
              },
            },
            {
              $group: {
                _id: "$businessId",
                complaintsCount30d: { $sum: 1 },
              },
            },
          ]),
          Review.aggregate<ReviewReputationAgg>([
            {
              $match: {
                businessId: { $in: trustedBusinessIds },
                isHidden: false,
                createdAt: { $gte: thirtyDaysAgo },
              },
            },
            {
              $group: {
                _id: "$businessId",
                avgRating30d: { $avg: "$rating" },
                reviewsCount30d: { $sum: 1 },
              },
            },
          ]),
        ])
      : [[], [], []];

    const orderTrustMap = new Map(orderTrustAgg.map((row) => [String(row._id), row]));
    const complaintTrustMap = new Map(complaintTrustAgg.map((row) => [String(row._id), row]));
    const reviewReputationMap = new Map(
      reviewReputationAgg.map((row) => [String(row._id), row])
    );

    const businesses = rawBusinesses
      .map((b: any) => {
        const bLng = Number(b?.location?.coordinates?.[0]);
        const bLat = Number(b?.location?.coordinates?.[1]);
        if (!Number.isFinite(bLat) || !Number.isFinite(bLng)) return null;

        if (!isBusinessWithinCityCoverage(selectedCity, bLat, bLng)) return null;

        const subscription = computeSubscriptionStatus(b.subscription || {});
        if (subscription.status === "suspended") return null;

        const distanceKm =
          lat !== null && lng !== null ? haversineDistanceKm(lat, lng, bLat, bLng) : null;
        const distanceSortKm =
          lat !== null && lng !== null
            ? Number(distanceKm || 0)
            : haversineDistanceKm(cityCenter.lat, cityCenter.lng, bLat, bLng);

        const tier = normalizeTier(b?.performance?.tier);
        const score = Number(b?.performance?.score ?? 50);
        const overrideBoost = Number(b?.performance?.overrideBoost || 0);
        const effectiveScore = score + overrideBoost;
        const openStatus = isBusinessOpenNow(b);
        const etaSnapshot = computeOrderEtaSnapshot(b?.eta || null);

        const orderTrust = orderTrustMap.get(String(b._id));
        const complaintTrust = complaintTrustMap.get(String(b._id));
        const delivered30d = toNumber(orderTrust?.deliveredCount30d);
        const acceptedCount30d = Math.max(0, toNumber(orderTrust?.acceptedCount30d));
        const acceptedWithin7mCount30d = Math.max(0, toNumber(orderTrust?.acceptedWithin7mCount30d));
        const acceptanceWithin7mRate30d =
          acceptedCount30d > 0 ? acceptedWithin7mCount30d / acceptedCount30d : 0;
        const complaints30d = Math.max(0, toNumber(complaintTrust?.complaintsCount30d));
        const trustResult = computeTrustBadge({
          delivered30d,
          complaints30d,
          acceptanceWithin7mRate30d,
          isPaused: Boolean(b?.paused),
          isManuallyPaused: Boolean(b?.isManuallyPaused),
          businessTier: tier,
        });
        const reputation = reviewReputationMap.get(String(b._id));
        const delivery = getPublicDeliveryInfo(b as { deliveryPolicy?: Record<string, unknown> });

        return {
          id: String(b._id),
          type: b.type,
          name: b.name,
          phone: b.phone,
          whatsapp: b.whatsapp,
          address: b.address,
          logoUrl: b.logoUrl || "",
          distanceKm,
          performance: {
            tier,
            score,
          },
          isProbation: tier === "probation",
          isOpenNow: Boolean(openStatus.open),
          closedReason: openStatus.open ? null : openStatus.reason || null,
          nextOpenText: openStatus.open ? null : openStatus.nextOpenText || null,
          eta: {
            minMins: etaSnapshot.etaMinMins,
            maxMins: etaSnapshot.etaMaxMins,
            prepMins: etaSnapshot.etaPrepMins,
            text: etaSnapshot.etaText,
          },
          delivery: {
            mode: delivery.mode,
            noteEs: delivery.publicNoteEs,
          },
          trust: {
            badge: trustResult.badge,
            delivered30d,
            acceptanceWithin7mRate30d: Number(acceptanceWithin7mRate30d.toFixed(2)),
            complaints30d,
          },
          reputation: {
            avgRating30d: Number(Number(reputation?.avgRating30d || 0).toFixed(2)),
            reviewsCount30d: Number(reputation?.reviewsCount30d || 0),
          },
          isFavorite: favoriteSet.has(String(b._id)),
          freeDeliveryBadge:
            selectedCity.deliveryFeeModel === "restaurantPays"
              ? "Free delivery (paid by business)"
              : "Tarifa de delivery segun distancia",
          subscriptionStatus: subscription.status,
          _sort: {
            tierRank: TIER_RANK[tier],
            score: effectiveScore,
            distanceKm: distanceSortKm,
            name: String(b.name || ""),
          },
        };
      })
      .filter(Boolean) as Array<Record<string, unknown>>;

    businesses.sort((a, b) => {
      const sortA = (a as { _sort?: { tierRank?: number; score?: number; distanceKm?: number; name?: string } })
        ._sort || {};
      const sortB = (b as { _sort?: { tierRank?: number; score?: number; distanceKm?: number; name?: string } })
        ._sort || {};
      const tierDiff = Number(sortA.tierRank || 0) - Number(sortB.tierRank || 0);
      if (tierDiff !== 0) return tierDiff;
      const scoreDiff = Number(sortB.score || 0) - Number(sortA.score || 0);
      if (scoreDiff !== 0) return scoreDiff;
      const distanceDiff = Number(sortA.distanceKm || 0) - Number(sortB.distanceKm || 0);
      if (distanceDiff !== 0) return distanceDiff;
      return String(sortA.name || "").localeCompare(String(sortB.name || ""), "es");
    });

    const businessesResponse = businesses.map((item) => {
      const rest = { ...(item as Record<string, unknown>) };
      delete rest._sort;
      return rest;
    });

    const userWithinCoverage =
      lat !== null && lng !== null
        ? isWithinCityCoverage(selectedCity, lat, lng)
        : true;

    return ok({
      businesses: businessesResponse,
      coverage: {
        maxRadiusKm: cityRadiusKm,
        userWithinCoverage,
        message: userWithinCoverage
          ? "Estas dentro del area de cobertura."
          : `Estas fuera del area de cobertura (${cityRadiusKm}km). Solo puedes explorar por ahora.`,
      },
    });
  } catch {
    return fail("SERVER_ERROR", "Could not load businesses.", 500);
  }
}
