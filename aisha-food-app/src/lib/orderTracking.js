import AsyncStorage from "@react-native-async-storage/async-storage";
import { apiGet } from "./api";

const SAVED_CUSTOMER_KEY = "aisha_saved_customer";

function normalize(value) {
  return String(value || "").trim();
}

function isObjectIdLike(value) {
  return /^[a-f0-9]{24}$/i.test(normalize(value));
}

function deriveEtaMinutes(eta) {
  const min = Number(eta?.minMins || 0);
  const max = Number(eta?.maxMins || 0);
  if (min > 0 && max > 0) return Math.round((min + max) / 2);
  if (max > 0) return Math.round(max);
  if (min > 0) return Math.round(min);
  return null;
}

function normalizePhone(value) {
  return String(value || "").replace(/\D+/g, "").trim();
}

async function getSavedCustomerPhone() {
  try {
    const raw = await AsyncStorage.getItem(SAVED_CUSTOMER_KEY);
    if (!raw) return "";
    const saved = JSON.parse(raw);
    return normalizePhone(saved?.phone);
  } catch {
    return "";
  }
}

export async function fetchOrderTrackingSnapshot(input) {
  const request =
    input && typeof input === "object"
      ? input
      : {
          orderId: input,
        };
  const safeOrderId = normalize(request?.orderId);
  const safeOrderNumber = normalize(request?.orderNumber);
  const safePhone = normalizePhone(request?.phone) || (await getSavedCustomerPhone());

  if (!safeOrderId && !safeOrderNumber) {
    const error = new Error("orderId or orderNumber is required.");
    error.code = "VALIDATION_ERROR";
    throw error;
  }

  if (safeOrderNumber) {
    const params = new URLSearchParams({
      orderNumber: safeOrderNumber,
    });
    if (safePhone) {
      params.set("phone", safePhone);
    }
    const trackResponse = await apiGet(`/api/public/track?${params.toString()}`);
    const deliveryProof = trackResponse?.deliveryProof || trackResponse?.order?.deliveryProof || null;
    const payment = trackResponse?.payment ||
      trackResponse?.order?.payment || {
        method: "cash",
        status: trackResponse?.order?.paymentStatus || "pending",
        paidAt: null,
        provider: null,
        reference: null,
      };
    const paymentEvents = Array.isArray(trackResponse?.paymentEvents) ? trackResponse.paymentEvents : [];
    const amountEvent = paymentEvents.find((event) => Number.isFinite(Number(event?.amount)));

    return {
      orderId: normalize(trackResponse?.orderId || trackResponse?.order?.orderId || safeOrderId) || null,
      orderNumber: normalize(trackResponse?.orderNumber || trackResponse?.order?.orderNumber || safeOrderNumber) || null,
      businessName:
        normalize(trackResponse?.businessName || trackResponse?.order?.businessName || trackResponse?.contact?.businessName || request?.businessName) ||
        null,
      status: String(trackResponse?.status || trackResponse?.order?.status || "new"),
      deliveryMode: String(
        trackResponse?.deliveryMode || trackResponse?.delivery?.mode || trackResponse?.order?.deliveryMode || ""
      ).trim() || "self_delivery",
      deliveryUi: trackResponse?.deliveryUi || trackResponse?.order?.deliveryUi || null,
      driverName: trackResponse?.driverName || trackResponse?.order?.driverName || null,
      driverPhone: trackResponse?.driverPhone || trackResponse?.order?.driverPhone || null,
      driverLocation: trackResponse?.driverLocation || trackResponse?.order?.driverLocation || null,
      etaMinutes:
        Number.isFinite(Number(trackResponse?.etaMinutes))
          ? Number(trackResponse.etaMinutes)
          : deriveEtaMinutes(trackResponse?.eta || trackResponse?.order?.eta),
      loyaltyPointsPending: Number(trackResponse?.loyaltyPointsPending || 0),
      referralCodeUsed: trackResponse?.referralCodeUsed || null,
      referralRewardPending: Boolean(trackResponse?.referralRewardPending),
      deliveryProof,
      payment,
      paymentEvents,
      totalAmount: amountEvent
        ? Number(amountEvent.amount)
        : Number.isFinite(Number(trackResponse?.totalAmount || trackResponse?.order?.total))
          ? Number(trackResponse?.totalAmount || trackResponse?.order?.total)
          : null,
    };
  }

  if (safeOrderId && isObjectIdLike(safeOrderId)) {
    const statusQuery = safePhone ? `?phone=${encodeURIComponent(safePhone)}` : "";
    const [statusResponse, paymentResponse] = await Promise.all([
      apiGet(`/api/public/orders/${encodeURIComponent(safeOrderId)}/status${statusQuery}`),
      apiGet(`/api/public/orders/${encodeURIComponent(safeOrderId)}/payment`),
    ]);
    const paymentEvents = Array.isArray(paymentResponse?.events) ? paymentResponse.events : [];
    const amountEvent = paymentEvents.find((event) => Number.isFinite(Number(event?.amount)));

    return {
      orderId: safeOrderId,
      orderNumber: normalize(statusResponse?.orderNumber || safeOrderNumber) || null,
      businessName: normalize(statusResponse?.businessName || request?.businessName) || null,
      status: String(statusResponse?.status || "new"),
      deliveryMode: String(statusResponse?.deliveryMode || "").trim() || "self_delivery",
      deliveryUi: statusResponse?.deliveryUi || null,
      driverName: statusResponse?.driverName || null,
      driverPhone: statusResponse?.driverPhone || null,
      driverLocation: statusResponse?.driverLocation || null,
      etaMinutes: Number.isFinite(Number(statusResponse?.etaMinutes))
        ? Number(statusResponse.etaMinutes)
        : null,
      loyaltyPointsPending: Number(statusResponse?.loyaltyPointsPending || 0),
      referralCodeUsed: statusResponse?.referralCodeUsed || null,
      referralRewardPending: Boolean(statusResponse?.referralRewardPending),
      deliveryProof: statusResponse?.deliveryProof || null,
      payment: paymentResponse?.payment || {
        method: "cash",
        status: "pending",
        paidAt: null,
        provider: null,
        reference: null,
      },
      paymentEvents,
      totalAmount: amountEvent ? Number(amountEvent.amount) : null,
    };
  }
}

export async function enrichHistoryOrder(order) {
  const safeOrder = order && typeof order === "object" ? order : {};
  const orderId = String(safeOrder?.orderId || "").trim();
  if (!orderId) return safeOrder;

  try {
    const live = await fetchOrderTrackingSnapshot(orderId);
    return {
      ...safeOrder,
      status: live.status,
      deliveryMode: live.deliveryMode,
      deliveryUi: live.deliveryUi,
      driverName: live.driverName,
      driverPhone: live.driverPhone,
      driverLocation: live.driverLocation,
      etaMinutes: live.etaMinutes,
      payment: live.payment,
    };
  } catch {
    return safeOrder;
  }
}
