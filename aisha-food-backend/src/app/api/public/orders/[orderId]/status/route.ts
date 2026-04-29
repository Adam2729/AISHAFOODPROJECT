import mongoose from "mongoose";
import { ok, fail } from "@/lib/apiResponse";
import { resolveCityFromRequest, requireActiveCity } from "@/lib/city";
import {
  getCustomerDeliveryUi,
  getSafeCustomerDriverName,
} from "@/lib/deliveryStatusPresentation";
import { dbConnect } from "@/lib/mongodb";
import { normalizePhone, phoneToHash } from "@/lib/phoneHash";
import { Business } from "@/models/Business";
import { Driver } from "@/models/Driver";
import { Order } from "@/models/Order";

type ApiError = Error & { status?: number; code?: string };

const DRIVER_LOCATION_VISIBLE_STATUSES = ["accepted", "preparing", "ready", "out_for_delivery"];

function deriveEtaMinutes(eta?: { minMins?: number | null; maxMins?: number | null } | null) {
  const min = Number(eta?.minMins || 0);
  const max = Number(eta?.maxMins || 0);
  if (min > 0 && max > 0) return Math.round((min + max) / 2);
  if (max > 0) return Math.round(max);
  if (min > 0) return Math.round(min);
  return null;
}

function sameLegacyPhone(inputPhone: string, orderPhone: string) {
  const normalizedInput = normalizePhone(inputPhone);
  const normalizedOrder = normalizePhone(orderPhone);
  if (!normalizedInput || !normalizedOrder) return false;
  return normalizedInput === normalizedOrder;
}

function serializeLatestDriverLocation(location: unknown) {
  const raw = (location || {}) as {
    lat?: unknown;
    lng?: unknown;
    accuracy?: unknown;
    heading?: unknown;
    speed?: unknown;
    updatedAt?: unknown;
  };
  const lat = Number(raw.lat);
  const lng = Number(raw.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  return {
    latitude: lat,
    longitude: lng,
    lat,
    lng,
    accuracy: raw.accuracy == null ? null : Number(raw.accuracy),
    heading: raw.heading == null ? null : Number(raw.heading),
    speed: raw.speed == null ? null : Number(raw.speed),
    updatedAt: raw.updatedAt || null,
  };
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ orderId: string }> }
) {
  try {
    await dbConnect();
    const selectedCity = await resolveCityFromRequest(req);
    requireActiveCity(selectedCity);
    const url = new URL(req.url);
    const phoneInput = String(url.searchParams.get("phone") || "").trim();

    const { orderId } = await params;
    if (!mongoose.Types.ObjectId.isValid(orderId)) {
      return fail("VALIDATION_ERROR", "Invalid orderId.", 400);
    }

    const order = await Order.findOne({
      _id: new mongoose.Types.ObjectId(orderId),
      cityId: new mongoose.Types.ObjectId(String(selectedCity._id)),
    })
      .select(
        "_id orderNumber businessId businessName status total eta referral.usedCode deliveryProof deliverySnapshot.mode phone phoneHash dispatch.assignedDriverId dispatch.assignedDriverName dispatch.assignedAt dispatch.pickupConfirmedAt merchantDelivery.assignedAt merchantDelivery.riderName merchantDelivery.riderPhone"
      )
      .lean<{
        _id: mongoose.Types.ObjectId;
        orderNumber?: string;
        businessId?: mongoose.Types.ObjectId | null;
        businessName?: string | null;
        status?: string;
        total?: number;
        phone?: string | null;
        phoneHash?: string | null;
        eta?: { minMins?: number; maxMins?: number };
        referral?: {
          usedCode?: string | null;
        };
        deliveryProof?: {
          required?: boolean | null;
          otpLast4?: string | null;
          verifiedAt?: Date | null;
          verifiedBy?: "customer_code" | "admin_override" | null;
          failedAttempts?: number | null;
        };
        dispatch?: {
          assignedDriverId?: mongoose.Types.ObjectId | null;
          assignedDriverName?: string | null;
          assignedAt?: Date | null;
          pickupConfirmedAt?: Date | null;
        };
        deliverySnapshot?: {
          mode?: string | null;
        };
        merchantDelivery?: {
          assignedAt?: Date | null;
          riderName?: string | null;
          riderPhone?: string | null;
        };
      } | null>();

    if (!order) {
      return fail("NOT_FOUND", "Order not found.", 404);
    }

    const business = order.businessId
      ? await Business.findById(order.businessId)
          .select("deliveryType")
          .lean<{ deliveryType?: string | null } | null>()
      : null;
    const deliveryUi = getCustomerDeliveryUi(order, business);
    const normalizedPhone = normalizePhone(phoneInput);
    const phoneHash = normalizedPhone ? phoneToHash(normalizedPhone) : "";
    const orderPhoneHash = String(order.phoneHash || "").trim();
    const ownerByHash = Boolean(phoneHash) && orderPhoneHash && orderPhoneHash === phoneHash;
    const ownerByLegacy = !orderPhoneHash && sameLegacyPhone(phoneInput, String(order.phone || ""));
    const ownerMatches = ownerByHash || ownerByLegacy;
    const normalizedStatus = String(order.status || "new").trim().toLowerCase();

    const driverId = order.dispatch?.assignedDriverId
      ? String(order.dispatch.assignedDriverId)
      : "";

    const driver = driverId
      ? await Driver.findOne({
          _id: new mongoose.Types.ObjectId(driverId),
          cityId: new mongoose.Types.ObjectId(String(selectedCity._id)),
        })
          .select("_id name lastLocation")
          .lean<{
            _id: mongoose.Types.ObjectId;
            name?: string;
            lastLocation?: unknown;
          } | null>()
      : null;
    const driverLocation =
      ownerMatches &&
      deliveryUi.deliveryMode === "platform_driver" &&
      DRIVER_LOCATION_VISIBLE_STATUSES.includes(normalizedStatus)
        ? serializeLatestDriverLocation(driver?.lastLocation)
        : null;
    const rawDriverName =
      String(order.dispatch?.assignedDriverName || driver?.name || order.merchantDelivery?.riderName || "").trim() ||
      null;

    return ok({
      orderId: String(order._id),
      orderNumber: String(order.orderNumber || "").trim() || null,
      businessName: String(order.businessName || "").trim() || null,
      status: String(order.status || "new"),
      deliveryMode: deliveryUi.deliveryMode,
      deliveryUi,
      driverName:
        deliveryUi.deliveryMode === "platform_driver"
          ? ownerMatches
            ? getSafeCustomerDriverName(rawDriverName)
            : null
          : rawDriverName,
      driverPhone:
        deliveryUi.deliveryMode === "self_delivery"
          ? String(order.merchantDelivery?.riderPhone || "").trim() || null
          : null,
      driverLocation,
      etaMinutes: deriveEtaMinutes(order.eta || null),
      loyaltyPointsPending:
        ["delivered", "cancelled"].includes(String(order.status || ""))
          ? 0
          : Math.max(0, Math.floor(Number(order.total || 0) / 100)),
      referralCodeUsed: String(order.referral?.usedCode || "").trim() || null,
      referralRewardPending:
        Boolean(String(order.referral?.usedCode || "").trim()) &&
        !["delivered", "cancelled"].includes(String(order.status || "")),
      deliveryProof: {
        required: Boolean(order.deliveryProof?.required),
        otpLast4: String(order.deliveryProof?.otpLast4 || "").trim() || null,
        verifiedAt: order.deliveryProof?.verifiedAt || null,
        verifiedBy: order.deliveryProof?.verifiedBy || null,
        failedAttempts: Number(order.deliveryProof?.failedAttempts || 0),
      },
    });
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not load order status.",
      err.status || 500
    );
  }
}
