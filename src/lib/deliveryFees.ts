import { haversineDistanceKm } from "@/lib/geo";
import type { CityLean, DeliveryFeeBand } from "@/lib/city";

type LatLng = {
  lat: number;
  lng: number;
};

type ComputeDeliveryFeeInput = {
  city: Pick<
    CityLean,
    "deliveryFeeModel" | "deliveryFeeBands" | "platformDeliveryMargin" | "riderPayoutFlat"
  >;
  customerLatLng: LatLng;
  businessLatLng: LatLng;
};

export type DeliveryFeeQuote = {
  distanceKm: number;
  band: DeliveryFeeBand | null;
  fee: number;
  payoutToRider: number;
  platformMargin: number;
};

function toInt(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.round(parsed));
}

function isBandMatch(distanceKm: number, band: DeliveryFeeBand) {
  const minKm = Number(band.minKm || 0);
  const maxKm = Number(band.maxKm || 0);
  if (!Number.isFinite(distanceKm)) return false;
  if (distanceKm < 0) return false;

  const lowerOk = minKm <= 0 ? distanceKm >= 0 : distanceKm > minKm;
  return lowerOk && distanceKm <= maxKm;
}

function outOfRangeError() {
  const err = new Error("No delivery fee band found for this distance.") as Error & {
    code?: string;
    status?: number;
  };
  err.code = "DELIVERY_FEE_OUT_OF_RANGE";
  err.status = 409;
  return err;
}

export function computeDeliveryFeeForOrder(input: ComputeDeliveryFeeInput): DeliveryFeeQuote {
  const distanceKm = haversineDistanceKm(
    Number(input.customerLatLng.lat),
    Number(input.customerLatLng.lng),
    Number(input.businessLatLng.lat),
    Number(input.businessLatLng.lng)
  );

  if (input.city.deliveryFeeModel === "restaurantPays") {
    return {
      distanceKm,
      band: null,
      fee: 0,
      payoutToRider: 0,
      platformMargin: 0,
    };
  }

  const bands = Array.isArray(input.city.deliveryFeeBands)
    ? input.city.deliveryFeeBands
        .map((band) => ({
          minKm: Number(band?.minKm || 0),
          maxKm: Number(band?.maxKm || 0),
          fee: toInt(band?.fee),
        }))
        .filter((band) => band.maxKm > band.minKm)
        .sort((a, b) => a.minKm - b.minKm || a.maxKm - b.maxKm)
    : [];
  const matchedBand = bands.find((band) => isBandMatch(distanceKm, band));
  if (!matchedBand) {
    throw outOfRangeError();
  }

  const fee = toInt(matchedBand.fee);
  const configuredMargin = toInt(input.city.platformDeliveryMargin);
  let payoutToRider = Math.min(fee, Math.max(0, fee - configuredMargin));
  const flatPayout = toInt(input.city.riderPayoutFlat);
  if (flatPayout > 0) {
    payoutToRider = Math.min(flatPayout, fee);
  }
  const platformMargin = Math.max(0, fee - payoutToRider);

  return {
    distanceKm,
    band: matchedBand,
    fee,
    payoutToRider,
    platformMargin,
  };
}
