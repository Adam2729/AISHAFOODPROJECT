import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { ok, fail } from "@/lib/apiResponse";
import { assertNotInMaintenance } from "@/lib/maintenance";
import { requireDriverCityContext } from "@/lib/driverContext";
import { getDriverDeliveryUi } from "@/lib/deliveryStatusPresentation";
import { paymentMethodLabel, paymentStatusLabel } from "@/lib/payment";
import { SUPPORT_WHATSAPP_DEFAULT_TEXT, SUPPORT_WHATSAPP_E164 } from "@/lib/constants";
import { Business } from "@/models/Business";
import { Order } from "@/models/Order";

type ApiError = Error & { status?: number; code?: string };

type OrderDetailRow = {
  _id: mongoose.Types.ObjectId;
  businessId?: mongoose.Types.ObjectId | null;
  orderNumber?: string;
  businessName?: string;
  customerName?: string;
  phone?: string;
  address?: string;
  notes?: string;
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
  createdAt?: Date | null;
  eta?: { text?: string };
  deliverySnapshot?: { mode?: string | null };
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

type BusinessContactRow = {
  _id: mongoose.Types.ObjectId;
  name?: string;
  phone?: string;
  whatsapp?: string;
  address?: string;
} | null;

const LOCATION_VISIBLE_STATUSES = ["accepted", "preparing", "ready", "out_for_delivery"];

function serializeItemsSummary(items: OrderDetailRow["items"]) {
  return Array.isArray(items)
    ? items.map((item) => ({
        name: String(item?.name || ""),
        qty: Math.max(1, Number(item?.qty || 1)),
        unitPrice: Number(item?.unitPrice || 0),
        lineTotal: Number(item?.lineTotal || 0),
      }))
    : [];
}

function serializePaymentSummary(order: OrderDetailRow) {
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

function shouldCollectAmount(order: OrderDetailRow) {
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

function formatItemSummary(items: OrderDetailRow["items"]) {
  return serializeItemsSummary(items)
    .map((item) => `${item.qty}x ${item.name}`.trim())
    .filter((value) => value && !value.endsWith("x"))
    .join(", ");
}

function normalizeDigits(value: unknown) {
  return String(value || "").replace(/\D+/g, "");
}

function serializeContact(input: {
  order: OrderDetailRow;
  business: BusinessContactRow;
  supportWhatsApp?: string;
  supportText?: string;
}) {
  const businessPhone = String(input.business?.phone || "").trim();
  const businessWhatsApp = String(input.business?.whatsapp || "").trim();
  const supportWhatsApp = normalizeDigits(input.supportWhatsApp);

  return {
    customerName: String(input.order.customerName || "").trim(),
    customerPhone: String(input.order.phone || "").trim(),
    businessName: String(input.business?.name || input.order.businessName || "").trim(),
    businessPhone,
    businessWhatsApp,
    supportWhatsApp,
    supportText: String(input.supportText || "").trim(),
  };
}

function serializeLatestLocation(location: unknown) {
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
  context: { params: Promise<{ orderId: string }> }
) {
  try {
    await assertNotInMaintenance();
    await dbConnect();

    const { driver, city } = await requireDriverCityContext(req);
    const { orderId } = await context.params;
    if (!mongoose.Types.ObjectId.isValid(orderId)) {
      return fail("VALIDATION_ERROR", "Valid orderId is required.", 400);
    }

    const driverIdObj = new mongoose.Types.ObjectId(String(driver._id));
    const driverAvailability = String(driver.availability || "offline");
    const eligibleForAvailableOrders = driverAvailability === "available" && !driver.pausedAt;
    const order = await Order.findOne({
      _id: new mongoose.Types.ObjectId(orderId),
      cityId: new mongoose.Types.ObjectId(String(city._id)),
      "deliverySnapshot.mode": "platform_driver",
      "dispatch.assignedDriverId": driverIdObj,
    })
      .select(
        "_id businessId orderNumber businessName customerName phone address notes items.name items.qty items.unitPrice items.lineTotal subtotal deliveryFeeToCustomer riderPayoutExpectedAtOrderTime total currency payment.method payment.status payment.provider payment.reference paymentStatus status eta createdAt deliverySnapshot.mode dispatch.driverDispatchStatus dispatch.assignedDriverId dispatch.assignedDriverName dispatch.assignedAt dispatch.currentOfferDriverId dispatch.currentOfferAttemptId dispatch.currentOfferSentAt dispatch.offerExpiresAt dispatch.currentOfferDistanceKm dispatch.driverArrivedAt dispatch.pickupConfirmedAt dispatch.arrivedAtCustomerAt dispatch.paymentCollectedAt dispatch.paymentCollectionMethod dispatch.paymentCollectionProvider dispatch.paymentCollectionReference dispatch.paymentCollectionNote dispatch.deliveredConfirmedAt dispatch.cashCollectedByDriver dispatch.handoffNote dispatch.routeBatchId dispatch.routeSequence dispatch.currentStopIndex deliveryProof.required deliveryProof.otpLast4 deliveryProof.verifiedAt deliveryProof.note deliveryProof.photoUrl deliveryProof.capturedAt deliveryProof.capturedByDriverId deliveryException.reason deliveryException.note deliveryException.reportedAt deliveryException.reportedByDriverId deliveryException.status"
      )
      .lean<OrderDetailRow | null>();

    if (!order) {
      return fail("NOT_FOUND", "Platform-driver order not found for this driver.", 404);
    }

    const assignedDriverId = order.dispatch?.assignedDriverId
      ? String(order.dispatch.assignedDriverId)
      : null;
    const isAssignedToCurrentDriver = assignedDriverId === String(driver._id);
    const driverLocation =
      isAssignedToCurrentDriver && LOCATION_VISIBLE_STATUSES.includes(String(order.status || ""))
        ? serializeLatestLocation(driver.lastLocation)
        : null;
    const business = order.businessId
      ? await Business.findById(order.businessId)
          .select("_id name phone whatsapp address")
          .lean<BusinessContactRow>()
      : null;
    const contact = serializeContact({
      order,
      business,
      supportWhatsApp:
        String((city as { supportWhatsAppE164?: string | null }).supportWhatsAppE164 || "").trim() ||
        SUPPORT_WHATSAPP_E164,
      supportText: SUPPORT_WHATSAPP_DEFAULT_TEXT,
    });
    const driverUi = getDriverDeliveryUi(order);

    return ok({
      order: {
        id: String(order._id),
        orderId: String(order._id),
        orderNumber: String(order.orderNumber || ""),
        businessName: String(order.businessName || ""),
        business: {
          id: business?._id ? String(business._id) : String(order.businessId || ""),
          name: String(business?.name || order.businessName || ""),
          phone: String(business?.phone || "").trim() || null,
          whatsapp: String(business?.whatsapp || "").trim() || null,
          address: String(business?.address || "").trim() || null,
        },
        pickup: {
          address: String(business?.address || order.businessName || ""),
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
        notes: String(order.notes || ""),
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
        assignedAt: order.dispatch?.assignedAt || null,
        canAccept: false,
        offerExpiresAt: order.dispatch?.offerExpiresAt || null,
        estimatedDistanceKm:
          order.dispatch?.currentOfferDistanceKm == null
            ? null
            : Number(order.dispatch.currentOfferDistanceKm),
        estimatedEarning: Number(
          order.riderPayoutExpectedAtOrderTime || order.deliveryFeeToCustomer || 0
        ),
        deliveryMode: String(order.deliverySnapshot?.mode || "platform_driver"),
        eta: {
          text: String(order.eta?.text || ""),
        },
        createdAt: order.createdAt || null,
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
          sequence:
            order.dispatch?.routeSequence == null ? null : Number(order.dispatch.routeSequence),
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
        contact,
        support: {
          whatsapp: contact.supportWhatsApp,
          defaultText: contact.supportText,
        },
        driver: {
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
          lastLocation: driver.lastLocation || null,
        },
        driverLocation,
      },
    });
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not load driver order.",
      err.status || 500
    );
  }
}
