/* eslint-disable @typescript-eslint/no-explicit-any */
import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { ok, fail } from "@/lib/apiResponse";
import { SUPPORT_WHATSAPP_DEFAULT_TEXT, SUPPORT_WHATSAPP_E164 } from "@/lib/constants";
import { isOrderStatus } from "@/lib/orderStatus";
import { statusHintEs, statusLabelEs, statusProgressPct } from "@/lib/orderStatusView";
import { computeOrderEtaSnapshot } from "@/lib/eta";
import { DELIVERY_DISCLAIMER_ES, getPublicDeliveryInfo } from "@/lib/deliveryPolicy";
import {
  getCustomerDeliveryUi,
  getSafeCustomerDriverName,
} from "@/lib/deliveryStatusPresentation";
import { deriveOrderOtp, isOtpExpired } from "@/lib/deliveryOtp";
import { normalizePhone, phoneToHash } from "@/lib/phoneHash";
import { attachRequestIdHeader, getOrCreateRequestId } from "@/lib/requestId";
import { Business } from "@/models/Business";
import { Driver } from "@/models/Driver";
import { Order } from "@/models/Order";

const DRIVER_LOCATION_VISIBLE_STATUSES = ["accepted", "preparing", "ready", "out_for_delivery"];

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

export async function GET(req: Request) {
  const requestId = getOrCreateRequestId(req);
  const withRequestId = <T extends Response>(response: T) =>
    attachRequestIdHeader(response, requestId);

  try {
    const url = new URL(req.url);
    const orderNumber = url.searchParams.get("orderNumber")?.trim() || "";
    const orderId = url.searchParams.get("orderId")?.trim() || "";
    const phoneInput = String(url.searchParams.get("phone") || "").trim();
    if (!orderNumber && !orderId) {
      return withRequestId(fail("VALIDATION_ERROR", "orderId or orderNumber is required."));
    }
    if (orderId && !mongoose.Types.ObjectId.isValid(orderId) && !orderNumber) {
      return withRequestId(fail("VALIDATION_ERROR", "orderId must be a valid id.", 400));
    }

    await dbConnect();
    const order = orderId && mongoose.Types.ObjectId.isValid(orderId)
      ? await Order.findById(orderId).lean()
      : await Order.findOne({ orderNumber }).lean();
    if (!order) return withRequestId(fail("NOT_FOUND", "Order not found.", 404));
    const business = await Business.findById((order as any).businessId)
      .select("name whatsapp phone eta deliveryType deliveryPolicy")
      .lean();
    const createdAt = new Date((order as any).createdAt);
    const acceptedAtRaw = (order as any)?.statusTimestamps?.acceptedAt || null;
    const acceptedAt = acceptedAtRaw ? new Date(acceptedAtRaw) : null;
    const isNewStatus = String((order as any).status || "") === "new";
    const acceptanceDelayMinutes = Number.isNaN(createdAt.getTime())
      ? null
      : acceptedAt
      ? Math.max(0, Math.round((acceptedAt.getTime() - createdAt.getTime()) / 60000))
      : isNewStatus
      ? Math.max(0, Math.round((Date.now() - createdAt.getTime()) / 60000))
      : null;
    const statusValue = String((order as any).status || "").trim();
    const normalizedStatus = isOrderStatus(statusValue) ? statusValue : "new";
    const orderEtaRaw = (order as any)?.eta;
    const orderEta = orderEtaRaw
      ? {
          minMins: Number(orderEtaRaw.minMins || 25),
          maxMins: Number(orderEtaRaw.maxMins || 40),
          prepMins: Number(orderEtaRaw.prepMins || 15),
          text: String(orderEtaRaw.text || "25-40 min"),
        }
      : (() => {
          const snapshot = computeOrderEtaSnapshot((business as any)?.eta || null);
          return {
            minMins: snapshot.etaMinMins,
            maxMins: snapshot.etaMaxMins,
            prepMins: snapshot.etaPrepMins,
            text: snapshot.etaText,
          };
        })();
    const businessEtaSnapshot = computeOrderEtaSnapshot((business as any)?.eta || null);
    const lastUpdateAt = (order as any).updatedAt || (order as any).createdAt || null;
    const reviewRating = Number((order as any)?.review?.rating || 0);
    const reviewReviewedAtRaw = (order as any)?.review?.reviewedAt || null;
    const reviewReviewedAtDate = reviewReviewedAtRaw ? new Date(reviewReviewedAtRaw) : null;
    const reviewReviewedAt =
      reviewReviewedAtDate && !Number.isNaN(reviewReviewedAtDate.getTime())
        ? reviewReviewedAtDate.toISOString()
        : null;
    const contact = {
      whatsapp: String((business as any)?.whatsapp || ""),
      phone: String((business as any)?.phone || ""),
      businessName: String((business as any)?.name || (order as any).businessName || ""),
    };
    const businessDeliveryInfo = getPublicDeliveryInfo(
      (business as { deliveryType?: string; deliveryPolicy?: Record<string, unknown> }) || {}
    );
    const snapshotDelivery = (order as any)?.deliverySnapshot || null;
    const delivery = {
      mode:
        String(snapshotDelivery?.mode || "").trim() === "platform_driver"
          ? "platform_driver"
          : String(snapshotDelivery?.mode || "").trim() === "self_delivery"
            ? "self_delivery"
            : businessDeliveryInfo.mode,
      noteEs:
        String(snapshotDelivery?.noteEs || "").trim() || businessDeliveryInfo.publicNoteEs,
    };
    const deliveryUi = getCustomerDeliveryUi(order as any, business as { deliveryType?: string | null });
    const normalizedPhone = normalizePhone(phoneInput);
    const phoneHash = normalizedPhone ? phoneToHash(normalizedPhone) : "";
    const orderPhoneHash = String((order as any)?.phoneHash || "").trim();
    const ownerByHash = Boolean(phoneHash) && orderPhoneHash && orderPhoneHash === phoneHash;
    const ownerByLegacy = !orderPhoneHash && sameLegacyPhone(phoneInput, String((order as any)?.phone || ""));
    const ownerMatches = ownerByHash || ownerByLegacy;
    let driverLocation = null;
    const assignedDriverId = (order as any)?.dispatch?.assignedDriverId || null;
    let assignedDriver: { name?: string | null; lastLocation?: unknown } | null = null;
    if (
      ownerMatches &&
      delivery.mode === "platform_driver" &&
      assignedDriverId &&
      DRIVER_LOCATION_VISIBLE_STATUSES.includes(normalizedStatus)
    ) {
      assignedDriver = await Driver.findById(assignedDriverId)
        .select("name lastLocation")
        .lean<{ name?: string | null; lastLocation?: unknown } | null>();
      driverLocation = serializeLatestDriverLocation(assignedDriver?.lastLocation);
    }

    const proof = (order as any)?.deliveryProof || {};
    const required = proof?.required !== false;
    const otpCreatedAt = proof?.otpCreatedAt || (order as any)?.createdAt || null;
    const otpExpired = isOtpExpired(otpCreatedAt);
    const verifiedAt = proof?.verifiedAt || null;
    const otpLast4 = String(proof?.otpLast4 || "").trim() || null;
    const shouldReturnRawOtp =
      ownerMatches &&
      required &&
      !verifiedAt &&
      normalizedStatus !== "delivered" &&
      !otpExpired &&
      Boolean(proof?.otpHash);
    const deliveryOtp = shouldReturnRawOtp
      ? deriveOrderOtp(String((order as any).orderNumber || ""), otpCreatedAt)
      : null;
    const payment = {
      method: String((order as any)?.payment?.method || "cash").trim() || "cash",
      status: String((order as any)?.payment?.status || (order as any)?.paymentStatus || "pending").trim() || "pending",
      paidAt: (order as any)?.payment?.paidAt || null,
      provider: String((order as any)?.payment?.provider || "").trim() || null,
      reference: String((order as any)?.payment?.reference || "").trim() || null,
    };
    const rawDriverName =
      String(
        (order as any)?.dispatch?.assignedDriverName ||
          (assignedDriver as { name?: string | null } | null)?.name ||
          (order as any)?.merchantDelivery?.riderName ||
          ""
      ).trim() || null;
    const driverName = delivery.mode === "platform_driver"
      ? ownerMatches
        ? getSafeCustomerDriverName(rawDriverName)
        : null
      : rawDriverName;
    const driverPhone = delivery.mode === "self_delivery"
      ? String((order as any)?.merchantDelivery?.riderPhone || "").trim() || null
      : null;
    const deliveryProof = {
      required,
      verifiedAt,
      otpLast4,
      verifiedBy: proof?.verifiedBy || null,
      failedAttempts: Number(proof?.failedAttempts || 0),
      otpExpired,
      instructionsEs: "Comparte tu codigo con el repartidor para confirmar entrega.",
      ...(shouldReturnRawOtp && deliveryOtp ? { otp: deliveryOtp } : {}),
    };

    return withRequestId(ok({
      order: {
        orderId: String((order as any)._id),
        orderNumber: (order as any).orderNumber,
        status: (order as any).status,
        statusLabelEs: statusLabelEs(normalizedStatus),
        statusProgressPct: statusProgressPct(normalizedStatus),
        statusHintEs: statusHintEs(normalizedStatus),
        paymentStatus: (order as any).payment?.status || (order as any).paymentStatus || "unpaid",
        total: (order as any).total,
        businessId: String((order as any).businessId),
        businessName: (order as any).businessName,
        createdAt: (order as any).createdAt,
        lastUpdateAt,
        acceptedAt,
        firstActionAt: (order as any)?.sla?.firstActionAt || null,
        acceptanceDelayMinutes,
        review: {
          rating: reviewRating >= 1 && reviewRating <= 5 ? reviewRating : null,
          reviewedAt: reviewReviewedAt,
        },
        eta: orderEta,
        business: {
          eta: {
            minMins: businessEtaSnapshot.etaMinMins,
            maxMins: businessEtaSnapshot.etaMaxMins,
            prepMins: businessEtaSnapshot.etaPrepMins,
            text: businessEtaSnapshot.etaText,
          },
        },
        delivery,
        deliveryMode: delivery.mode,
        deliveryUi,
        contact,
        payment,
        driverName,
        driverPhone,
        driverLocation,
        support: {
          whatsapp: SUPPORT_WHATSAPP_E164,
          defaultText: SUPPORT_WHATSAPP_DEFAULT_TEXT,
          deliveryDisclaimerEs: DELIVERY_DISCLAIMER_ES,
        },
        deliveryProof,
      },
      orderId: String((order as any)._id),
      statusLabelEs: statusLabelEs(normalizedStatus),
      statusProgressPct: statusProgressPct(normalizedStatus),
      lastUpdateAt,
      review: {
        rating: reviewRating >= 1 && reviewRating <= 5 ? reviewRating : null,
        reviewedAt: reviewReviewedAt,
      },
      eta: orderEta,
      delivery,
      deliveryMode: delivery.mode,
      deliveryUi,
      contact,
      orderNumber: String((order as any).orderNumber || "").trim() || null,
      businessName: String((order as any).businessName || "") || null,
      payment,
      driverName,
      driverPhone,
      driverLocation,
      support: {
        whatsapp: SUPPORT_WHATSAPP_E164,
        defaultText: SUPPORT_WHATSAPP_DEFAULT_TEXT,
        deliveryDisclaimerEs: DELIVERY_DISCLAIMER_ES,
      },
      deliveryProof,
      ...(shouldReturnRawOtp && deliveryOtp ? { deliveryOtp } : {}),
    }));
  } catch {
    return withRequestId(fail("SERVER_ERROR", "Could not track order.", 500));
  }
}
