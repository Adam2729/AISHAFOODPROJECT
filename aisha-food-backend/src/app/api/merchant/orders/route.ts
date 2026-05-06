import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { ok, fail } from "@/lib/apiResponse";
import { requireMerchantSession } from "@/lib/merchantAuth";
import { requireMerchantBusinessAvailable } from "@/lib/merchantBusiness";
import { getMerchantDeliveryUi } from "@/lib/deliveryStatusPresentation";
import { Order } from "@/models/Order";
import { Business } from "@/models/Business";
import { Driver } from "@/models/Driver";

type ApiError = Error & { status?: number; code?: string };

export const dynamic = "force-dynamic";

type DriverSnapshot = {
  _id: mongoose.Types.ObjectId;
  name?: string | null;
  phoneE164?: string | null;
  availability?: string | null;
  lastLocation?: {
    lat?: number | null;
    lng?: number | null;
    updatedAt?: Date | string | null;
  } | null;
};

function toNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function haversineKm(
  left: { lat: number; lng: number },
  right: { lat: number; lng: number }
) {
  const toRadians = (input: number) => (input * Math.PI) / 180;
  const dLat = toRadians(right.lat - left.lat);
  const dLng = toRadians(right.lng - left.lng);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(left.lat)) *
      Math.cos(toRadians(right.lat)) *
      Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function serializeDriverLocation(location: DriverSnapshot["lastLocation"]) {
  const lat = toNumber(location?.lat);
  const lng = toNumber(location?.lng);
  if (lat == null || lng == null) {
    return null;
  }
  return {
    latitude: lat,
    longitude: lng,
    lat,
    lng,
    updatedAt: location?.updatedAt || null,
  };
}

function estimateDriverEtaMinutes(
  location: ReturnType<typeof serializeDriverLocation>,
  businessLocation: { lat: number; lng: number } | null
) {
  if (!location || !businessLocation) {
    return null;
  }
  const distanceKm = haversineKm(
    { lat: location.latitude, lng: location.longitude },
    businessLocation
  );
  return Math.max(2, Math.min(45, Math.round((distanceKm / 18) * 60)));
}

function deriveDriverStatus(
  order: Record<string, unknown>,
  hasAssignedDriver: boolean
) {
  if (!hasAssignedDriver) return "";

  const status = String(order.status || "").trim().toLowerCase();
  const dispatch = (order.dispatch || {}) as {
    driverArrivedAt?: Date | string | null;
    pickupConfirmedAt?: Date | string | null;
    arrivedAtCustomerAt?: Date | string | null;
  };

  if (status === "delivered") return "delivered";
  if (dispatch.arrivedAtCustomerAt) return "nearby";
  if (status === "out_for_delivery") return "on_the_way";
  if (dispatch.pickupConfirmedAt) return "picked_up";
  if (dispatch.driverArrivedAt) return "arriving_at_restaurant";
  return "assigned";
}

export async function GET(req: Request) {
  try {
    const session = requireMerchantSession(req);
    if (!mongoose.Types.ObjectId.isValid(session.businessId)) {
      return fail("UNAUTHORIZED", "Invalid merchant session.", 401);
    }

    const url = new URL(req.url);
    const status = url.searchParams.get("status")?.trim() || "";

    await dbConnect();
    await requireMerchantBusinessAvailable(session.businessId);
    const business = await Business.findById(new mongoose.Types.ObjectId(session.businessId))
      .select("deliveryType location zoneLabel")
      .lean<{
        deliveryType?: string | null;
        zoneLabel?: string | null;
        location?: { coordinates?: number[] | null } | null;
      } | null>();
    const filter: Record<string, unknown> = { businessId: new mongoose.Types.ObjectId(session.businessId) };
    if (status) {
      filter.status = status;
    } else {
      filter.status = { $ne: "pending_payment" };
    }

    const orders = await Order.find(filter).sort({ createdAt: -1 }).lean();
    const assignedDriverIds = orders
      .map((order) => String((order as { dispatch?: { assignedDriverId?: mongoose.Types.ObjectId | null } }).dispatch?.assignedDriverId || "").trim())
      .filter((value, index, rows) => mongoose.Types.ObjectId.isValid(value) && rows.indexOf(value) === index)
      .map((value) => new mongoose.Types.ObjectId(value));
    const drivers = assignedDriverIds.length
      ? await Driver.find({ _id: { $in: assignedDriverIds } })
          .select("name phoneE164 availability lastLocation")
          .lean<DriverSnapshot[]>()
      : [];
    const driverMap = new Map(drivers.map((row) => [String(row._id), row]));
    const businessCoordsRaw = Array.isArray(business?.location?.coordinates)
      ? business.location.coordinates
      : [];
    const businessLocation =
      businessCoordsRaw.length >= 2 &&
      Number.isFinite(Number(businessCoordsRaw[1])) &&
      Number.isFinite(Number(businessCoordsRaw[0]))
        ? {
            lat: Number(businessCoordsRaw[1]),
            lng: Number(businessCoordsRaw[0]),
          }
        : null;
    const nowMs = Date.now();
    const mapped = orders.map((order) => {
      const createdAt = new Date((order as { createdAt?: Date | string }).createdAt || "");
      const createdMs = createdAt.getTime();
      const acceptedAtRaw = (order as { statusTimestamps?: { acceptedAt?: Date | string | null } })
        .statusTimestamps?.acceptedAt;
      const acceptedAt = acceptedAtRaw ? new Date(acceptedAtRaw) : null;
      const acceptedMs = acceptedAt?.getTime() ?? null;
      const acceptanceDelayMinutes =
        Number.isNaN(createdMs)
          ? null
          : Number.isFinite(Number(acceptedMs))
          ? Math.max(0, Math.round((Number(acceptedMs) - createdMs) / 60000))
          : (order as { status?: string }).status === "new"
          ? Math.max(0, Math.round((nowMs - createdMs) / 60000))
          : null;

      const deliveryUi = getMerchantDeliveryUi(order, business);
      const assignedDriverId = String((order as { dispatch?: { assignedDriverId?: mongoose.Types.ObjectId | null } }).dispatch?.assignedDriverId || "").trim();
      const assignedDriver = assignedDriverId ? driverMap.get(assignedDriverId) || null : null;
      const driverLocation = serializeDriverLocation(assignedDriver?.lastLocation || null);
      const driverEtaMinutes = estimateDriverEtaMinutes(driverLocation, businessLocation);
      const driverStatus = deriveDriverStatus(
        order as unknown as Record<string, unknown>,
        Boolean(assignedDriverId)
      );

      return {
        ...order,
        deliveryMode: deliveryUi.deliveryMode,
        deliveryUi,
        acceptedAt: acceptedAtRaw || null,
        acceptanceDelayMinutes,
        driverStatus,
        driverEtaMinutes,
        driverLocation,
        driverLastUpdatedAt: driverLocation?.updatedAt || null,
        driverPhone: String(assignedDriver?.phoneE164 || "").trim() || null,
        driverAvailability: String(assignedDriver?.availability || "").trim() || null,
      };
    });
    return ok({ orders: mapped });
  } catch (e: unknown) {
    const err = e as ApiError;
    return fail(err.code || "SERVER_ERROR", err.message || "Could not load merchant orders.", err.status || 500);
  }
}
