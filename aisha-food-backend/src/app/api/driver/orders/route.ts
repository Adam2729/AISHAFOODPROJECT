import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { ok, fail } from "@/lib/apiResponse";
import { assertNotInMaintenance } from "@/lib/maintenance";
import { cityCode } from "@/lib/city";
import { requireDriverCityContext } from "@/lib/driverContext";
import { getDriverDeliveryUi } from "@/lib/deliveryStatusPresentation";
import { loadCurrentDriverOffer } from "@/lib/driverDispatchOffers";
import { paymentMethodLabel, paymentStatusLabel } from "@/lib/payment";
import { Business } from "@/models/Business";
import { Order } from "@/models/Order";

type ApiError = Error & { status?: number; code?: string };

type OrderRow = {
  _id: mongoose.Types.ObjectId;
  businessId?: mongoose.Types.ObjectId | null;
  orderNumber?: string;
  businessName?: string;
  customerName?: string;
  phone?: string;
  address?: string;
  items?: Array<{
    name?: string;
    qty?: number;
    unitPrice?: number;
    lineTotal?: number;
  }>;
  subtotal?: number;
  deliveryFeeToCustomer?: number;
  riderPayoutExpectedAtOrderTime?: number | null;
  total?: number;
  currency?: string | null;
  payment?: {
    method?: string | null;
    status?: string | null;
    provider?: string | null;
    reference?: string | null;
  };
  paymentStatus?: string | null;
  status?: string;
  createdAt?: Date;
  eta?: {
    text?: string;
  };
  deliverySnapshot?: {
    mode?: string | null;
  };
  dispatch?: {
    driverDispatchStatus?: string | null;
    assignedDriverId?: mongoose.Types.ObjectId | null;
    assignedDriverName?: string | null;
    assignedAt?: Date | null;
    currentOfferDriverId?: mongoose.Types.ObjectId | null;
    currentOfferAttemptId?: mongoose.Types.ObjectId | null;
    currentOfferSentAt?: Date | null;
    offerExpiresAt?: Date | null;
    currentOfferDistanceKm?: number | null;
    driverArrivedAt?: Date | null;
    pickupConfirmedAt?: Date | null;
    arrivedAtCustomerAt?: Date | null;
    paymentCollectedAt?: Date | null;
    paymentCollectionMethod?: string | null;
    paymentCollectionProvider?: string | null;
    paymentCollectionReference?: string | null;
    paymentCollectionNote?: string | null;
    deliveredConfirmedAt?: Date | null;
    cashCollectedByDriver?: boolean;
    handoffNote?: string | null;
    routeBatchId?: string | null;
    routeSequence?: number | null;
    currentStopIndex?: number | null;
  };
  deliveryProof?: {
    required?: boolean;
    otpLast4?: string | null;
    verifiedAt?: Date | null;
    note?: string | null;
    photoUrl?: string | null;
    capturedAt?: Date | null;
    capturedByDriverId?: mongoose.Types.ObjectId | null;
  };
  deliveryException?: {
    reason?: string | null;
    note?: string | null;
    reportedAt?: Date | null;
    reportedByDriverId?: mongoose.Types.ObjectId | null;
    status?: string | null;
  };
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

function serializeItemsSummary(items: OrderRow["items"]) {
  return Array.isArray(items)
    ? items.map((item) => ({
        name: String(item?.name || ""),
        qty: Math.max(1, Number(item?.qty || 1)),
        unitPrice: Number(item?.unitPrice || 0),
        lineTotal: Number(item?.lineTotal || 0),
      }))
    : [];
}

function serializePaymentSummary(order: OrderRow) {
  const method = String(order.payment?.method || "cash");
  const status = String(order.payment?.status || order.paymentStatus || "pending");
  const provider =
    String(order.payment?.provider || order.dispatch?.paymentCollectionProvider || "").trim() ||
    null;
  const reference =
    String(order.payment?.reference || order.dispatch?.paymentCollectionReference || "").trim() ||
    null;

  return {
    method,
    methodLabel: paymentMethodLabel(method),
    status,
    statusLabel: paymentStatusLabel(status),
    provider,
    reference,
  };
}

function shouldCollectAmount(order: OrderRow) {
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

function formatItemSummary(items: OrderRow["items"]) {
  return serializeItemsSummary(items)
    .map((item) => `${item.qty}x ${item.name}`.trim())
    .filter((value) => value && !value.endsWith("x"))
    .join(", ");
}

function serializeDriverOrder(order: OrderRow, business: BusinessRow = null) {
  const assignedDriverId = order.dispatch?.assignedDriverId
    ? String(order.dispatch.assignedDriverId)
    : null;
  const driverUi = getDriverDeliveryUi(order);
  const estimatedEarning = Number(
    order.riderPayoutExpectedAtOrderTime || order.deliveryFeeToCustomer || 0
  );
  const businessName =
    String(business?.name || order.businessName || "").trim() || String(order.businessName || "");
  const businessAddress =
    String(business?.address || "").trim() || String(order.businessName || "").trim();
  const businessPhone = String(business?.phone || "").trim() || null;
  const businessWhatsApp = String(business?.whatsapp || "").trim() || null;
  const businessLocation =
    Array.isArray(business?.location?.coordinates) && business.location.coordinates.length >= 2
      ? {
          lng: Number(business.location.coordinates[0]),
          lat: Number(business.location.coordinates[1]),
        }
      : null;

  return {
    id: String(order._id),
    orderId: String(order._id),
    orderNumber: String(order.orderNumber || ""),
    businessId: order.businessId ? String(order.businessId) : null,
    businessName,
    pickup: {
      address: businessAddress,
      location: businessLocation,
    },
    customerName: String(order.customerName || ""),
    customerPhone: String(order.phone || ""),
    customer: {
      name: String(order.customerName || ""),
      phone: String(order.phone || ""),
      address: String(order.address || ""),
    },
    address: String(order.address || ""),
    dropoff: {
      address: String(order.address || ""),
    },
    itemsSummary: serializeItemsSummary(order.items),
    itemSummary: formatItemSummary(order.items),
    subtotal: Number(order.subtotal || 0),
    deliveryFeeToCustomer: Number(order.deliveryFeeToCustomer || 0),
    total: Number(order.total || 0),
    orderTotal: Number(order.total || 0),
    currency: String(order.currency || ""),
    totals: {
      subtotal: Number(order.subtotal || 0),
      deliveryFeeToCustomer: Number(order.deliveryFeeToCustomer || 0),
      total: Number(order.total || 0),
    },
    paymentSummary: serializePaymentSummary(order),
    amountToCollect: shouldCollectAmount(order) ? Number(order.total || 0) : 0,
    status: String(order.status || ""),
    driverUi,
    assignmentType: "assigned",
    assignedDriverId,
    canAccept: false,
    assignedAt: order.dispatch?.assignedAt || null,
    offerExpiresAt: order.dispatch?.offerExpiresAt || null,
    estimatedDistanceKm:
      order.dispatch?.currentOfferDistanceKm == null
        ? null
        : Number(order.dispatch.currentOfferDistanceKm),
    estimatedEarning,
    deliveryMode: String(order.deliverySnapshot?.mode || "platform_driver"),
    eta: {
      text: String(order.eta?.text || ""),
    },
    createdAt: order.createdAt || null,
    business: {
      id: order.businessId ? String(order.businessId) : null,
      name: businessName,
      address: businessAddress,
      phone: businessPhone,
      whatsapp: businessWhatsApp,
      location: businessLocation,
    },
    contact: {
      businessName,
      businessPhone,
      businessWhatsApp,
      customerPhone: String(order.phone || "").trim() || null,
    },
    dispatch: {
      driverDispatchStatus: String(order.dispatch?.driverDispatchStatus || "").trim() || null,
      assignedDriverId,
      assignedDriverName: String(order.dispatch?.assignedDriverName || "").trim() || null,
      assignedAt: order.dispatch?.assignedAt || null,
      currentOfferDriverId: order.dispatch?.currentOfferDriverId
        ? String(order.dispatch.currentOfferDriverId)
        : null,
      currentOfferAttemptId: order.dispatch?.currentOfferAttemptId
        ? String(order.dispatch.currentOfferAttemptId)
        : null,
      currentOfferSentAt: order.dispatch?.currentOfferSentAt || null,
      offerExpiresAt: order.dispatch?.offerExpiresAt || null,
      currentOfferDistanceKm:
        order.dispatch?.currentOfferDistanceKm == null
          ? null
          : Number(order.dispatch.currentOfferDistanceKm),
      driverArrivedAt: order.dispatch?.driverArrivedAt || null,
      pickupConfirmedAt: order.dispatch?.pickupConfirmedAt || null,
      arrivedAtCustomerAt: order.dispatch?.arrivedAtCustomerAt || null,
      paymentCollectedAt: order.dispatch?.paymentCollectedAt || null,
      paymentCollectionMethod:
        String(order.dispatch?.paymentCollectionMethod || "").trim() || null,
      paymentCollectionProvider:
        String(order.dispatch?.paymentCollectionProvider || "").trim() || null,
      paymentCollectionReference:
        String(order.dispatch?.paymentCollectionReference || "").trim() || null,
      paymentCollectionNote:
        String(order.dispatch?.paymentCollectionNote || "").trim() || null,
      deliveredConfirmedAt: order.dispatch?.deliveredConfirmedAt || null,
      cashCollectedByDriver: Boolean(order.dispatch?.cashCollectedByDriver),
      handoffNote: String(order.dispatch?.handoffNote || "").trim() || null,
      routeBatchId: String(order.dispatch?.routeBatchId || "").trim() || null,
      routeSequence:
        order.dispatch?.routeSequence == null ? null : Number(order.dispatch.routeSequence),
      currentStopIndex:
        order.dispatch?.currentStopIndex == null ? null : Number(order.dispatch.currentStopIndex),
    },
    routeBatch: {
      batchId: String(order.dispatch?.routeBatchId || "").trim() || null,
      sequence: order.dispatch?.routeSequence == null ? null : Number(order.dispatch.routeSequence),
      currentStopIndex:
        order.dispatch?.currentStopIndex == null ? null : Number(order.dispatch.currentStopIndex),
    },
    deliveryProof: {
      required: order.deliveryProof?.required !== false,
      otpLast4: String(order.deliveryProof?.otpLast4 || "").trim() || null,
      verifiedAt: order.deliveryProof?.verifiedAt || null,
      note: String(order.deliveryProof?.note || "").trim() || null,
      photoUrl: String(order.deliveryProof?.photoUrl || "").trim() || null,
      capturedAt: order.deliveryProof?.capturedAt || null,
      capturedByDriverId: order.deliveryProof?.capturedByDriverId
        ? String(order.deliveryProof.capturedByDriverId)
        : null,
    },
    deliveryException: order.deliveryException?.reportedAt
      ? {
          reason: String(order.deliveryException.reason || "").trim() || null,
          note: String(order.deliveryException.note || "").trim() || null,
          reportedAt: order.deliveryException.reportedAt || null,
          reportedByDriverId: order.deliveryException.reportedByDriverId
            ? String(order.deliveryException.reportedByDriverId)
            : null,
          status: String(order.deliveryException.status || "").trim() || null,
        }
      : null,
  };
}

export async function GET(req: Request) {
  try {
    await assertNotInMaintenance();
    await dbConnect();
    const { driver, city, authMode } = await requireDriverCityContext(req);
    const cityIdObj = new mongoose.Types.ObjectId(String(city._id));
    const activeStatuses = ["accepted", "preparing", "ready", "out_for_delivery"];
    const driverAvailability = String(driver.availability || "offline");
    const eligibleForAvailableOrders = driverAvailability === "available" && !driver.pausedAt;
    const [activeOrder, currentOffer] = await Promise.all([
      Order.findOne({
        cityId: cityIdObj,
        "deliverySnapshot.mode": "platform_driver",
        "dispatch.assignedDriverId": driver._id,
        status: { $in: activeStatuses },
      })
        .select(
          "_id businessId orderNumber businessName customerName phone address items.name items.qty items.unitPrice items.lineTotal subtotal deliveryFeeToCustomer riderPayoutExpectedAtOrderTime total currency payment.method payment.status payment.provider payment.reference paymentStatus status eta createdAt deliverySnapshot.mode dispatch.driverDispatchStatus dispatch.assignedDriverId dispatch.assignedDriverName dispatch.assignedAt dispatch.currentOfferDriverId dispatch.currentOfferAttemptId dispatch.currentOfferSentAt dispatch.offerExpiresAt dispatch.currentOfferDistanceKm dispatch.driverArrivedAt dispatch.pickupConfirmedAt dispatch.arrivedAtCustomerAt dispatch.paymentCollectedAt dispatch.paymentCollectionMethod dispatch.paymentCollectionProvider dispatch.paymentCollectionReference dispatch.paymentCollectionNote dispatch.deliveredConfirmedAt dispatch.cashCollectedByDriver dispatch.handoffNote dispatch.routeBatchId dispatch.routeSequence dispatch.currentStopIndex deliveryProof.required deliveryProof.otpLast4 deliveryProof.verifiedAt deliveryProof.note deliveryProof.photoUrl deliveryProof.capturedAt deliveryProof.capturedByDriverId deliveryException.reason deliveryException.note deliveryException.reportedAt deliveryException.reportedByDriverId deliveryException.status"
        )
        .sort({ "dispatch.assignedAt": -1, createdAt: -1 })
        .lean<OrderRow | null>(),
      eligibleForAvailableOrders
        ? loadCurrentDriverOffer({
            cityId: cityIdObj,
            driverId: new mongoose.Types.ObjectId(String(driver._id)),
          })
        : Promise.resolve(null),
    ]);

    const activeOrderBusiness =
      activeOrder?.businessId && mongoose.Types.ObjectId.isValid(String(activeOrder.businessId))
        ? await Business.findById(activeOrder.businessId)
            .select("_id name address phone whatsapp location.coordinates")
            .lean<BusinessRow>()
        : null;
    const activeOrderPayload = activeOrder
      ? serializeDriverOrder(activeOrder, activeOrderBusiness)
      : null;

    return ok({
      authMode,
      scope: "driver_state",
      driver: {
        id: String(driver._id),
        name: String(driver.name || ""),
        zoneLabel: String(driver.zoneLabel || "").trim() || null,
        availability: driverAvailability,
        status:
          driverAvailability === "available"
            ? "online"
            : driverAvailability === "busy"
            ? "busy"
            : driverAvailability === "paused"
            ? "paused"
            : "offline",
        eligibleForAvailableOrders,
        breakStartedAt: driver.breakStartedAt || null,
        breakReason: String(driver.breakReason || "").trim() || null,
        breakNote: String(driver.breakNote || "").trim() || null,
        lastSeenAt: driver.lastSeenAt || null,
        lastLocation: driver.lastLocation || null,
      },
      city: {
        cityId: String(city._id),
        code: cityCode(city),
        name: String(city.name || ""),
      },
      currentOffer: currentOffer || null,
      activeOrder: activeOrderPayload,
      orders: activeOrderPayload ? [activeOrderPayload] : [],
    });
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not load driver orders.",
      err.status || 500
    );
  }
}
