import mongoose from "mongoose";
import { ok, fail } from "@/lib/apiResponse";
import { cityCode } from "@/lib/city";
import { requireDriverCityContext } from "@/lib/driverContext";
import { assertNotInMaintenance } from "@/lib/maintenance";
import { dbConnect } from "@/lib/mongodb";
import { paymentMethodLabel, paymentStatusLabel } from "@/lib/payment";
import { Business } from "@/models/Business";
import { Order } from "@/models/Order";

type ApiError = Error & { status?: number; code?: string };

type ActiveOrderRow = {
  _id: mongoose.Types.ObjectId;
  businessId?: mongoose.Types.ObjectId | null;
  orderNumber?: string | null;
  businessName?: string | null;
  customerName?: string | null;
  phone?: string | null;
  address?: string | null;
  notes?: string | null;
  customerLocation?: {
    lat?: number | null;
    lng?: number | null;
  } | null;
  total?: number | null;
  currency?: string | null;
  payment?: {
    method?: string | null;
    status?: string | null;
    provider?: string | null;
    reference?: string | null;
  } | null;
  paymentStatus?: string | null;
  status?: string | null;
  createdAt?: Date | null;
  deliverySnapshot?: {
    mode?: string | null;
  } | null;
  dispatch?: {
    driverDispatchStatus?: string | null;
    assignedDriverId?: mongoose.Types.ObjectId | null;
    assignedDriverName?: string | null;
    assignedAt?: Date | null;
    driverArrivedAt?: Date | null;
    pickupConfirmedAt?: Date | null;
    arrivedAtCustomerAt?: Date | null;
    paymentCollectedAt?: Date | null;
    paymentCollectionMethod?: string | null;
    paymentCollectionProvider?: string | null;
    paymentCollectionReference?: string | null;
    paymentCollectionNote?: string | null;
    deliveredConfirmedAt?: Date | null;
  } | null;
};

type BusinessRow = {
  _id: mongoose.Types.ObjectId;
  name?: string | null;
  address?: string | null;
  phone?: string | null;
  whatsapp?: string | null;
  location?: {
    coordinates?: number[] | null;
  } | null;
} | null;

const ACTIVE_PLATFORM_DRIVER_STATUSES = [
  "accepted",
  "preparing",
  "ready",
  "out_for_delivery",
] as const;

function textOrNull(value: unknown) {
  const text = String(value || "").trim();
  return text || null;
}

function numberOrNull(value: unknown) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : null;
}

function buildBusinessGeoPoint(business: BusinessRow) {
  if (!Array.isArray(business?.location?.coordinates) || business.location.coordinates.length < 2) {
    return null;
  }

  const pickupLng = numberOrNull(business.location.coordinates[0]);
  const pickupLat = numberOrNull(business.location.coordinates[1]);
  if (pickupLat == null || pickupLng == null) {
    return null;
  }

  return {
    lat: pickupLat,
    lng: pickupLng,
  };
}

function buildCustomerGeoPoint(order: ActiveOrderRow) {
  const dropoffLat = numberOrNull(order.customerLocation?.lat);
  const dropoffLng = numberOrNull(order.customerLocation?.lng);
  if (dropoffLat == null || dropoffLng == null) {
    return null;
  }

  return {
    lat: dropoffLat,
    lng: dropoffLng,
  };
}

function hasRealValue(value: unknown): boolean {
  if (typeof value === "number") {
    return Number.isFinite(value);
  }
  if (value instanceof Date) {
    return !Number.isNaN(value.getTime());
  }
  if (Array.isArray(value)) {
    return value.some((entry) => hasRealValue(entry));
  }
  if (value && typeof value === "object") {
    return Object.values(value as Record<string, unknown>).some((entry) => hasRealValue(entry));
  }
  return Boolean(textOrNull(value));
}

function objectOrNull<T extends Record<string, unknown>>(value: T): T | null {
  return hasRealValue(value) ? value : null;
}

function shouldCollectAmount(order: ActiveOrderRow) {
  const method = String(order.payment?.method || "").trim().toLowerCase();
  const provider = String(order.payment?.provider || "").trim().toLowerCase();
  const status = String(order.payment?.status || order.paymentStatus || "").trim().toLowerCase();

  if (method === "cash") return true;
  if (method === "orange_money" || method === "wave" || method === "moov_money") {
    return status !== "paid";
  }
  if (method === "mobile_money") {
    return status !== "paid" || !provider;
  }
  return false;
}

function buildMissingFields(payload: {
  restaurantName: string | null;
  pickupAddress: string | null;
  customerName: string | null;
  deliveryAddress: string | null;
}) {
  const missingFields: string[] = [];
  if (!payload.restaurantName) missingFields.push("restaurant");
  if (!payload.pickupAddress) missingFields.push("pickup_address");
  if (!payload.customerName) missingFields.push("customer");
  if (!payload.deliveryAddress) missingFields.push("delivery_address");
  return missingFields;
}

function buildActiveDriverOrderPayload(order: ActiveOrderRow, business: BusinessRow = null) {
  const orderId = String(order._id);
  const publicOrderCode = textOrNull(order.orderNumber);
  const status = textOrNull(order.status);
  const deliveryMode = textOrNull(order.deliverySnapshot?.mode) || "platform_driver";
  const restaurantName =
    textOrNull(business?.name) || textOrNull(order.businessName);
  const restaurantPhone = textOrNull(business?.phone);
  const restaurantWhatsApp = textOrNull(business?.whatsapp);
  const pickupAddress = textOrNull(business?.address);
  const customerName = textOrNull(order.customerName);
  const customerPhone = textOrNull(order.phone);
  const deliveryAddress = textOrNull(order.address);
  const dropoffAddress = deliveryAddress;
  const deliveryNote =
    textOrNull(order.notes) ||
    textOrNull(order.dispatch?.paymentCollectionNote) ||
    null;
  const landmark = textOrNull(order.notes);
  const paymentMethod = textOrNull(order.payment?.method) || "cash";
  const paymentStatus =
    textOrNull(order.payment?.status) ||
    textOrNull(order.paymentStatus) ||
    "pending";
  const paymentProvider =
    textOrNull(order.payment?.provider) ||
    textOrNull(order.dispatch?.paymentCollectionProvider);
  const paymentReference =
    textOrNull(order.payment?.reference) ||
    textOrNull(order.dispatch?.paymentCollectionReference);
  const orderTotal = numberOrNull(order.total);
  const amountToCollect =
    shouldCollectAmount(order) && orderTotal != null ? orderTotal : 0;
  const pickupLocation = buildBusinessGeoPoint(business);
  const dropoffLocation = buildCustomerGeoPoint(order);
  const pickupLat = pickupLocation?.lat ?? null;
  const pickupLng = pickupLocation?.lng ?? null;
  const dropoffLat = dropoffLocation?.lat ?? null;
  const dropoffLng = dropoffLocation?.lng ?? null;
  const missingFields = buildMissingFields({
    restaurantName,
    pickupAddress,
    customerName,
    deliveryAddress,
  });

  return {
    orderId,
    publicOrderCode,
    orderNumber: publicOrderCode,
    status,
    deliveryMode,
    restaurantName,
    restaurantPhone,
    pickupAddress,
    customerName,
    customerPhone,
    dropoffAddress,
    deliveryAddress,
    pickupLat,
    pickupLng,
    dropoffLat,
    dropoffLng,
    deliveryNote,
    landmark,
    paymentMethod,
    paymentStatus,
    amountToCollect,
    orderTotal,
    currency: textOrNull(order.currency) || "CFA",
    driverArrivedAt: order.dispatch?.driverArrivedAt || null,
    pickupConfirmedAt: order.dispatch?.pickupConfirmedAt || null,
    arrivedAtCustomerAt: order.dispatch?.arrivedAtCustomerAt || null,
    paymentCollectedAt: order.dispatch?.paymentCollectedAt || null,
    assignedAt: order.dispatch?.assignedAt || null,
    createdAt: order.createdAt || null,
    businessName: restaurantName,
    address: deliveryAddress,
    pickup: objectOrNull({
      address: pickupAddress,
      location: pickupLocation,
    }),
    dropoff: objectOrNull({
      address: dropoffAddress,
      location: dropoffLocation,
    }),
    customer: objectOrNull({
      name: customerName,
      phone: customerPhone,
      address: deliveryAddress,
      location: dropoffLocation,
    }),
    business: objectOrNull({
      id: order.businessId ? String(order.businessId) : null,
      name: restaurantName,
      phone: restaurantPhone,
      whatsapp: restaurantWhatsApp,
      address: pickupAddress,
      location: pickupLocation,
    }),
    contact: objectOrNull({
      businessName: restaurantName,
      businessPhone: restaurantPhone,
      businessWhatsApp: restaurantWhatsApp,
      customerPhone,
    }),
    restaurant: objectOrNull({
      id: order.businessId ? String(order.businessId) : null,
      name: restaurantName,
      phone: restaurantPhone,
      whatsapp: restaurantWhatsApp,
      address: pickupAddress,
      location: pickupLocation,
      lat: pickupLat,
      lng: pickupLng,
    }),
    paymentSummary: {
      method: paymentMethod,
      methodLabel: paymentMethodLabel(paymentMethod),
      status: paymentStatus,
      statusLabel: paymentStatusLabel(paymentStatus),
      provider: paymentProvider,
      reference: paymentReference,
    },
    dispatch: {
      assignedDriverId: order.dispatch?.assignedDriverId
        ? String(order.dispatch.assignedDriverId)
        : null,
      assignedDriverName: textOrNull(order.dispatch?.assignedDriverName),
      assignedAt: order.dispatch?.assignedAt || null,
      driverDispatchStatus: textOrNull(order.dispatch?.driverDispatchStatus),
      driverArrivedAt: order.dispatch?.driverArrivedAt || null,
      pickupConfirmedAt: order.dispatch?.pickupConfirmedAt || null,
      arrivedAtCustomerAt: order.dispatch?.arrivedAtCustomerAt || null,
      paymentCollectedAt: order.dispatch?.paymentCollectedAt || null,
      paymentCollectionMethod: textOrNull(order.dispatch?.paymentCollectionMethod),
      paymentCollectionProvider: textOrNull(order.dispatch?.paymentCollectionProvider),
      paymentCollectionReference: textOrNull(order.dispatch?.paymentCollectionReference),
      paymentCollectionNote: textOrNull(order.dispatch?.paymentCollectionNote),
      deliveredConfirmedAt: order.dispatch?.deliveredConfirmedAt || null,
    },
    dataIntegrity: {
      missingFields,
      isIncomplete: missingFields.length > 0,
    },
  };
}

export async function GET(req: Request) {
  try {
    await assertNotInMaintenance();
    await dbConnect();

    const { authMode, driver, city } = await requireDriverCityContext(req);
    const cityObjectId = new mongoose.Types.ObjectId(String(city._id));
    const activeOrder = await Order.findOne({
      cityId: cityObjectId,
      "deliverySnapshot.mode": "platform_driver",
      "dispatch.assignedDriverId": driver._id,
      status: { $in: ACTIVE_PLATFORM_DRIVER_STATUSES },
      "dispatch.deliveredConfirmedAt": null,
    })
      .select(
        "_id businessId orderNumber businessName customerName phone address notes customerLocation.lat customerLocation.lng total currency payment.method payment.status payment.provider payment.reference paymentStatus status createdAt deliverySnapshot.mode dispatch.driverDispatchStatus dispatch.assignedDriverId dispatch.assignedDriverName dispatch.assignedAt dispatch.driverArrivedAt dispatch.pickupConfirmedAt dispatch.arrivedAtCustomerAt dispatch.paymentCollectedAt dispatch.paymentCollectionMethod dispatch.paymentCollectionProvider dispatch.paymentCollectionReference dispatch.paymentCollectionNote dispatch.deliveredConfirmedAt"
      )
      .sort({ "dispatch.assignedAt": -1, createdAt: -1 })
      .lean<ActiveOrderRow | null>();

    if (!activeOrder) {
      return fail(
        "NOT_FOUND",
        "No active platform-driver order assigned to this driver.",
        404
      );
    }

    const activeBusiness =
      activeOrder.businessId && mongoose.Types.ObjectId.isValid(String(activeOrder.businessId))
        ? await Business.findById(activeOrder.businessId)
            .select("_id name address phone whatsapp location.coordinates")
            .lean<BusinessRow>()
        : null;

    return ok({
      authMode,
      driver: {
        id: String(driver._id),
        name: textOrNull(driver.name),
        availability: textOrNull(driver.availability) || "offline",
      },
      city: {
        cityId: String(city._id),
        code: cityCode(city),
        name: textOrNull(city.name),
      },
      order: buildActiveDriverOrderPayload(activeOrder, activeBusiness),
    });
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not load active driver order.",
      err.status || 500
    );
  }
}
