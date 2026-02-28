import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { ok, fail } from "@/lib/apiResponse";
import { assertNotInMaintenance } from "@/lib/maintenance";
import {
  buildCityScopedFilter,
  getDefaultCity,
  isBusinessWithinCityCoverage,
  isDefaultCity,
  requireActiveCity,
  resolveCityFromRequest,
} from "@/lib/city";
import { computeDeliveryFeeForOrder } from "@/lib/deliveryFees";
import { Business } from "@/models/Business";

type ApiError = Error & { status?: number; code?: string };

function parseCoord(value: string | null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toBandLabel(band: { minKm: number; maxKm: number } | null) {
  if (!band) return null;
  return `${Number(band.minKm)}-${Number(band.maxKm)} km`;
}

export async function GET(req: Request) {
  try {
    await assertNotInMaintenance();
    const selectedCity = await resolveCityFromRequest(req);
    requireActiveCity(selectedCity);
    const defaultCity = await getDefaultCity();
    const includeUnassigned = isDefaultCity(selectedCity, defaultCity._id);

    const url = new URL(req.url);
    const businessId = String(url.searchParams.get("businessId") || "").trim();
    const lat = parseCoord(url.searchParams.get("lat"));
    const lng = parseCoord(url.searchParams.get("lng"));

    if (!mongoose.Types.ObjectId.isValid(businessId)) {
      return fail("VALIDATION_ERROR", "Valid businessId is required.", 400);
    }
    if (lat == null || lng == null) {
      return fail("VALIDATION_ERROR", "Valid lat and lng are required.", 400);
    }

    await dbConnect();
    const business = await Business.findOne({
      _id: new mongoose.Types.ObjectId(businessId),
      isActive: true,
      ...buildCityScopedFilter(selectedCity._id, { includeUnassigned }),
    })
      .select("_id location")
      .lean<{ _id: mongoose.Types.ObjectId; location?: { coordinates?: [number, number] } } | null>();
    if (!business) {
      return fail("NOT_FOUND", "Business not found.", 404);
    }

    const bLng = Number(business.location?.coordinates?.[0]);
    const bLat = Number(business.location?.coordinates?.[1]);
    if (!Number.isFinite(bLat) || !Number.isFinite(bLng)) {
      return fail("BUSINESS_LOCATION_INVALID", "Business location is invalid.", 409);
    }
    if (!isBusinessWithinCityCoverage(selectedCity, bLat, bLng)) {
      return fail("BUSINESS_OUTSIDE_CLUSTER", "Business is outside city coverage.", 400);
    }
    const delivery = computeDeliveryFeeForOrder({
      city: selectedCity,
      customerLatLng: { lat, lng },
      businessLatLng: { lat: bLat, lng: bLng },
    });

    return ok({
      delivery: {
        distanceKm: Number(delivery.distanceKm.toFixed(3)),
        fee: Number(delivery.fee || 0),
        payoutToRider: Number(delivery.payoutToRider || 0),
        platformMargin: Number(delivery.platformMargin || 0),
        band: delivery.band,
        bandLabel: toBandLabel(delivery.band),
      },
      model: selectedCity.deliveryFeeModel,
      currency: selectedCity.currency,
    });
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not compute delivery quote.",
      err.status || 500
    );
  }
}
