import mongoose from "mongoose";
import { ok, fail } from "@/lib/apiResponse";
import {
  getCityCenter,
  requireActiveCity,
  resolveCityFromRequest,
  type CityLean,
} from "@/lib/city";
import {
  buildRestaurantSlug,
  estimateRestaurantDeliveryMinutes,
  getRestaurantListDeliveryFee,
} from "@/lib/customerOrdering";
import { computeOrderEtaSnapshot } from "@/lib/eta";
import { haversineDistanceKm } from "@/lib/geo";
import { dbConnect } from "@/lib/mongodb";
import { getActiveRestaurantCampaignMap } from "@/lib/restaurantAds";
import { Business } from "@/models/Business";
import { RestaurantAdImpression } from "@/models/RestaurantAdImpression";
import { Review } from "@/models/Review";

type ApiError = Error & { status?: number; code?: string };

function parseIntegerParam(value: string | null, defaultValue: number, maxValue: number) {
  const parsed = Number(value || defaultValue);
  if (!Number.isInteger(parsed) || parsed < 0) return defaultValue;
  return Math.min(parsed, maxValue);
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function GET(req: Request) {
  try {
    await dbConnect();
    const selectedCity = await resolveCityFromRequest(req);
    requireActiveCity(selectedCity);

    const url = new URL(req.url);
    const limit = Math.max(1, parseIntegerParam(url.searchParams.get("limit"), 50, 200));
    const skip = parseIntegerParam(url.searchParams.get("skip"), 0, 100000);
    const q = String(url.searchParams.get("q") || "").trim();

    const filter: Record<string, unknown> = {
      cityId: new mongoose.Types.ObjectId(String(selectedCity._id)),
      isActive: true,
      type: "restaurant",
    };

    if (q) {
      const regex = new RegExp(escapeRegex(q), "i");
      filter.$or = [{ name: regex }, { address: regex }, { zoneLabel: regex }];
    }

    const rows = await Business.find(filter)
      .select("_id cityId name logoUrl zoneLabel eta createdAt location")
      .lean<
        Array<{
          _id: mongoose.Types.ObjectId;
          cityId?: mongoose.Types.ObjectId | null;
          name?: string;
          logoUrl?: string;
          zoneLabel?: string | null;
          createdAt?: Date | null;
          eta?: { minMins?: number; maxMins?: number; prepMins?: number };
          location?: { coordinates?: [number, number] };
        }>
      >();

    const businessIds = rows.map((row) => row._id);
    const [reviewAgg, adCampaigns] = await Promise.all([
      businessIds.length
        ? Review.aggregate<{ _id: mongoose.Types.ObjectId; avgRating?: number }>([
            {
              $match: {
                businessId: { $in: businessIds },
                isHidden: false,
              },
            },
            {
              $group: {
                _id: "$businessId",
                avgRating: { $avg: "$rating" },
              },
            },
          ])
        : Promise.resolve([]),
      getActiveRestaurantCampaignMap({
        cityId: selectedCity._id,
        businessIds,
      }),
    ]);

    const ratingByBusinessId = new Map(
      reviewAgg.map((row) => [String(row._id), Number(Number(row.avgRating || 0).toFixed(2))])
    );
    const cityCenter = getCityCenter(selectedCity);
    const city = selectedCity as Pick<
      CityLean,
      "deliveryFeeModel" | "deliveryFeeBands" | "coverageCenterLat" | "coverageCenterLng"
    >;

    const rankedRows = rows
      .map((row) => {
        const etaSnapshot = computeOrderEtaSnapshot(row.eta || null);
        const restaurantId = String(row._id);
        const campaign = adCampaigns.campaignsByBusinessId.get(restaurantId) || null;
        const coordinates = Array.isArray(row.location?.coordinates)
          ? row.location?.coordinates
          : null;
        const businessLng = Number(coordinates?.[0]);
        const businessLat = Number(coordinates?.[1]);
        const distanceKm =
          Number.isFinite(businessLat) && Number.isFinite(businessLng)
            ? Number(haversineDistanceKm(cityCenter.lat, cityCenter.lng, businessLat, businessLng).toFixed(3))
            : 999999;
        const averageRating = Number(ratingByBusinessId.get(restaurantId) || 0);
        const adPriority = campaign ? Number(campaign.priority || 0) : 0;

        return {
          restaurantId,
          name: String(row.name || ""),
          slug: buildRestaurantSlug({
            restaurantId,
            name: String(row.name || ""),
          }),
          logo: String(row.logoUrl || ""),
          zoneLabel: String(row.zoneLabel || "").trim() || null,
          deliveryFee: getRestaurantListDeliveryFee(city),
          estimatedDeliveryMinutes: estimateRestaurantDeliveryMinutes({
            minMins: etaSnapshot.etaMinMins,
            maxMins: etaSnapshot.etaMaxMins,
          }),
          sponsored: Boolean(campaign),
          campaignId: campaign ? String(campaign._id) : null,
          adPriority: campaign ? adPriority : null,
          averageRating,
          distanceKm: Number.isFinite(distanceKm) ? distanceKm : null,
          _sort: {
            sponsoredRank: campaign ? 1 : 0,
            adPriority,
            averageRating,
            distanceKm,
            createdAt: row.createdAt ? new Date(row.createdAt).getTime() : 0,
            name: String(row.name || ""),
          },
        };
      })
      .sort((left, right) => {
        if (left._sort.sponsoredRank !== right._sort.sponsoredRank) {
          return right._sort.sponsoredRank - left._sort.sponsoredRank;
        }
        if (left._sort.adPriority !== right._sort.adPriority) {
          return right._sort.adPriority - left._sort.adPriority;
        }
        if (left._sort.averageRating !== right._sort.averageRating) {
          return right._sort.averageRating - left._sort.averageRating;
        }
        if (left._sort.distanceKm !== right._sort.distanceKm) {
          return left._sort.distanceKm - right._sort.distanceKm;
        }
        if (left._sort.createdAt !== right._sort.createdAt) {
          return right._sort.createdAt - left._sort.createdAt;
        }
        return left._sort.name.localeCompare(right._sort.name, "fr");
      });

    const pagedRows = rankedRows.slice(skip, skip + limit).map((row) => {
      const rest = { ...row };
      delete (rest as { _sort?: unknown })._sort;
      return rest;
    });

    const impressionDocs = pagedRows
      .filter((row) => row.sponsored && row.campaignId)
      .map((row) => ({
        cityId: new mongoose.Types.ObjectId(String(selectedCity._id)),
        businessId: new mongoose.Types.ObjectId(row.restaurantId),
        campaignId: new mongoose.Types.ObjectId(String(row.campaignId)),
        timestamp: new Date(),
      }));

    if (impressionDocs.length) {
      await RestaurantAdImpression.insertMany(impressionDocs, { ordered: false }).catch((error) => {
        console.error(
          JSON.stringify({
            type: "restaurant_ad_impression_write_error",
            route: "public.restaurants.get",
            cityId: String(selectedCity._id),
            count: impressionDocs.length,
            error: error instanceof Error ? error.message : "Failed to write ad impressions",
            timestamp: new Date().toISOString(),
          })
        );
        return null;
      });
    }

    return ok({
      cityId: String(selectedCity._id),
      rows: pagedRows,
    });
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not load restaurants.",
      err.status || 500
    );
  }
}
