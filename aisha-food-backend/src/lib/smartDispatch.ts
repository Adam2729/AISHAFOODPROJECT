import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { Business } from "@/models/Business";
import { Driver } from "@/models/Driver";
import { Order } from "@/models/Order";

type DriverAvailability = "offline" | "available" | "busy" | "paused";

type GeoPoint = {
  lat: number;
  lng: number;
};

type CandidateDriver = {
  _id: mongoose.Types.ObjectId;
  name?: string;
  cityId?: mongoose.Types.ObjectId | null;
  isActive?: boolean;
  isBanned?: boolean;
  availability?: DriverAvailability;
  zoneLabel?: string | null;
  lastAssignedAt?: Date | null;
  lastLocation?: {
    lat?: number | null;
    lng?: number | null;
    updatedAt?: Date | null;
  } | null;
};

type SmartDispatchOrder = {
  _id: mongoose.Types.ObjectId;
  businessId?: mongoose.Types.ObjectId | null;
  zoneLabel?: string | null;
  businessZoneLabel?: string | null;
  businessLocation?: GeoPoint | null;
};

type BusinessDispatchContext = {
  zoneLabel: string | null;
  businessLocation: GeoPoint | null;
};

export type RankedDriverRow = {
  driverId: string;
  score: number;
  activeLoad: number;
  sameZone: boolean;
  distanceKm: number | null;
  locationFresh: boolean;
  zoneLabel: string | null;
  lastAssignedAt: Date | null;
};

type PickBestDriverOptions = {
  excludeDriverIds?: Array<mongoose.Types.ObjectId | string>;
  requireZeroActiveLoad?: boolean;
  preferNearest?: boolean;
};

function asObjectId(value: mongoose.Types.ObjectId | string) {
  return value instanceof mongoose.Types.ObjectId
    ? value
    : new mongoose.Types.ObjectId(String(value));
}

function normalizeZoneLabel(value: unknown) {
  const text = String(value || "").trim().toLowerCase();
  return text || null;
}

function normalizePoint(value: unknown): GeoPoint | null {
  const raw = (value || {}) as {
    lat?: unknown;
    lng?: unknown;
    coordinates?: unknown;
  };

  if (Array.isArray(raw.coordinates) && raw.coordinates.length >= 2) {
    const lng = Number(raw.coordinates[0]);
    const lat = Number(raw.coordinates[1]);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      return { lat, lng };
    }
  }

  const lat = Number(raw.lat);
  const lng = Number(raw.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

function toRadians(value: number) {
  return (value * Math.PI) / 180;
}

function haversineKm(origin: GeoPoint, target: GeoPoint) {
  const earthRadiusKm = 6371;
  const dLat = toRadians(target.lat - origin.lat);
  const dLng = toRadians(target.lng - origin.lng);
  const lat1 = toRadians(origin.lat);
  const lat2 = toRadians(target.lat);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.sin(dLng / 2) * Math.sin(dLng / 2) * Math.cos(lat1) * Math.cos(lat2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Number((earthRadiusKm * c).toFixed(2));
}

function isFreshLocation(updatedAt: unknown, maxAgeMinutes = 20) {
  if (!updatedAt) return false;
  if (
    !(updatedAt instanceof Date) &&
    typeof updatedAt !== "string" &&
    typeof updatedAt !== "number"
  ) {
    return false;
  }
  const parsed = new Date(updatedAt);
  if (Number.isNaN(parsed.getTime())) return false;
  return Date.now() - parsed.getTime() <= maxAgeMinutes * 60 * 1000;
}

async function resolveOrderDispatchContext(order: SmartDispatchOrder): Promise<BusinessDispatchContext> {
  const directZoneLabel = normalizeZoneLabel(order.zoneLabel || order.businessZoneLabel);
  const directLocation = normalizePoint(order.businessLocation);
  if (
    (directZoneLabel && directLocation) ||
    (!order.businessId || !mongoose.Types.ObjectId.isValid(String(order.businessId)))
  ) {
    return {
      zoneLabel: directZoneLabel,
      businessLocation: directLocation,
    };
  }

  const business = await Business.findById(order.businessId)
    .select("_id zoneLabel location")
    .lean<{
      _id: mongoose.Types.ObjectId;
      zoneLabel?: string | null;
      location?: { coordinates?: number[] } | null;
    } | null>();

  return {
    zoneLabel: directZoneLabel || normalizeZoneLabel(business?.zoneLabel),
    businessLocation: directLocation || normalizePoint(business?.location),
  };
}

export async function getDriverActiveLoad(
  driverId: mongoose.Types.ObjectId | string,
  cityId: mongoose.Types.ObjectId | string
) {
  await dbConnect();
  return Order.countDocuments({
    cityId: asObjectId(cityId),
    "dispatch.assignedDriverId": asObjectId(driverId),
    status: { $nin: ["delivered", "cancelled"] },
  });
}

export function computeDispatchScore(input: {
  driver: Pick<CandidateDriver, "availability" | "lastAssignedAt">;
  order: SmartDispatchOrder;
  activeLoad: number;
  sameZone: boolean;
  distanceKm?: number | null;
  now: Date;
}) {
  const zoneBoost = input.sameZone ? 20 : 0;
  const availabilityBoost = input.driver.availability === "available" ? 30 : 0;
  const loadPenalty = Math.max(0, Number(input.activeLoad || 0)) * 20;
  const distancePenalty =
    typeof input.distanceKm === "number" && Number.isFinite(input.distanceKm)
      ? Math.min(40, Math.round(input.distanceKm * 3))
      : input.sameZone
      ? 5
      : 12;

  let idleBoost = 0;
  if (input.driver.lastAssignedAt) {
    const idleMinutes = Math.min(
      180,
      Math.max(
        0,
        Math.floor(
          (input.now.getTime() - new Date(input.driver.lastAssignedAt).getTime()) / (60 * 1000)
        )
      )
    );
    idleBoost = Math.floor(idleMinutes / 10);
  } else {
    idleBoost = 18;
  }

  return availabilityBoost + zoneBoost + idleBoost - loadPenalty - distancePenalty;
}

export async function pickBestDriverForOrder(input: {
  cityId: mongoose.Types.ObjectId | string;
  order: SmartDispatchOrder;
  options?: PickBestDriverOptions;
}) {
  await dbConnect();

  const cityObjectId = asObjectId(input.cityId);
  const excludedIds = new Set(
    (Array.isArray(input.options?.excludeDriverIds) ? input.options?.excludeDriverIds : [])
      .map((value) => String(value || "").trim())
      .filter(Boolean)
  );
  const requireZeroActiveLoad = Boolean(input.options?.requireZeroActiveLoad);
  const preferNearest = Boolean(input.options?.preferNearest);

  const [drivers, orderContext] = await Promise.all([
    Driver.find({
      cityId: cityObjectId,
      isActive: true,
      isBanned: { $ne: true },
      availability: "available",
    })
      .select("_id name cityId isActive isBanned availability zoneLabel lastAssignedAt lastLocation")
      .lean<CandidateDriver[]>(),
    resolveOrderDispatchContext(input.order),
  ]);

  if (!drivers.length) {
    return {
      bestDriver: null,
      ranked: [] as RankedDriverRow[],
    };
  }

  const filteredDrivers = drivers.filter(
    (driver) => !excludedIds.has(String(driver._id || ""))
  );
  if (!filteredDrivers.length) {
    return {
      bestDriver: null,
      ranked: [] as RankedDriverRow[],
    };
  }

  const driverIds = filteredDrivers.map((driver) => driver._id);
  const activeLoadRows = await Order.aggregate<{
    _id: mongoose.Types.ObjectId;
    activeLoad?: number;
  }>([
    {
      $match: {
        cityId: cityObjectId,
        status: { $nin: ["delivered", "cancelled"] },
        "dispatch.assignedDriverId": { $in: driverIds },
      },
    },
    {
      $group: {
        _id: "$dispatch.assignedDriverId",
        activeLoad: { $sum: 1 },
      },
    },
  ]);

  const activeLoadByDriver = new Map(
    activeLoadRows.map((row) => [String(row._id), Number(row.activeLoad || 0)])
  );
  const driverById = new Map(filteredDrivers.map((driver) => [String(driver._id), driver]));
  const now = new Date();

  const ranked = filteredDrivers
    .map((driver) => {
      const sameZone =
        Boolean(orderContext.zoneLabel) &&
        normalizeZoneLabel(driver.zoneLabel) === normalizeZoneLabel(orderContext.zoneLabel);
      const activeLoad = activeLoadByDriver.get(String(driver._id)) || 0;
      const driverLocation = normalizePoint(driver.lastLocation);
      const locationFresh = isFreshLocation(driver.lastLocation?.updatedAt);
      const distanceKm =
        orderContext.businessLocation && driverLocation && locationFresh
          ? haversineKm(driverLocation, orderContext.businessLocation)
          : null;
      const score = computeDispatchScore({
        driver,
        order: input.order,
        activeLoad,
        sameZone,
        distanceKm,
        now,
      });

      return {
        driverId: String(driver._id),
        score,
        activeLoad,
        sameZone,
        distanceKm,
        locationFresh,
        zoneLabel: normalizeZoneLabel(driver.zoneLabel),
        lastAssignedAt: driver.lastAssignedAt || null,
      } satisfies RankedDriverRow;
    })
    .filter((row) => (requireZeroActiveLoad ? row.activeLoad === 0 : true))
    .sort((left, right) => {
      const leftHasDistance = typeof left.distanceKm === "number";
      const rightHasDistance = typeof right.distanceKm === "number";

      if (preferNearest) {
        if (leftHasDistance && rightHasDistance && left.distanceKm !== right.distanceKm) {
          return Number(left.distanceKm) - Number(right.distanceKm);
        }
        if (leftHasDistance !== rightHasDistance) {
          return leftHasDistance ? -1 : 1;
        }
        if (left.sameZone !== right.sameZone) {
          return left.sameZone ? -1 : 1;
        }
      }

      if (right.score !== left.score) return right.score - left.score;
      if (left.activeLoad !== right.activeLoad) return left.activeLoad - right.activeLoad;
      if (leftHasDistance && rightHasDistance && left.distanceKm !== right.distanceKm) {
        return Number(left.distanceKm) - Number(right.distanceKm);
      }

      const leftTime = left.lastAssignedAt
        ? new Date(left.lastAssignedAt).getTime()
        : Number.NEGATIVE_INFINITY;
      const rightTime = right.lastAssignedAt
        ? new Date(right.lastAssignedAt).getTime()
        : Number.NEGATIVE_INFINITY;
      if (leftTime !== rightTime) return leftTime - rightTime;

      return left.driverId.localeCompare(right.driverId);
    });

  return {
    bestDriver: ranked.length ? driverById.get(ranked[0].driverId) || null : null,
    ranked,
  };
}

export function estimateDispatchEtaMinutes(input: {
  activeLoad: number;
  sameZone: boolean;
  distanceKm?: number | null;
}) {
  if (typeof input.distanceKm === "number" && Number.isFinite(input.distanceKm)) {
    const distanceMinutes = Math.ceil(input.distanceKm * 4);
    const loadPenalty = Math.max(0, Number(input.activeLoad || 0)) * 6;
    const zoneAdjustment = input.sameZone ? -2 : 0;
    return Math.min(60, Math.max(6, distanceMinutes + loadPenalty + zoneAdjustment));
  }

  const raw = 12 + Math.max(0, Number(input.activeLoad || 0)) * 7 - (input.sameZone ? 3 : 0);
  return Math.min(60, Math.max(8, raw));
}
