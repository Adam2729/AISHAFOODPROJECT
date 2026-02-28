/* eslint-disable @typescript-eslint/no-explicit-any */
import { dbConnect } from "@/lib/mongodb";
import { ok, fail } from "@/lib/apiResponse";
import { SUPPORT_WHATSAPP_DEFAULT_TEXT, SUPPORT_WHATSAPP_E164 } from "@/lib/constants";
import { isOrderStatus } from "@/lib/orderStatus";
import { statusHintEs, statusLabelEs, statusProgressPct } from "@/lib/orderStatusView";
import { computeOrderEtaSnapshot } from "@/lib/eta";
import { DELIVERY_DISCLAIMER_ES, getPublicDeliveryInfo } from "@/lib/deliveryPolicy";
import { deriveOrderOtp, isOtpExpired } from "@/lib/deliveryOtp";
import { normalizePhone, phoneToHash } from "@/lib/phoneHash";
import { attachRequestIdHeader, getOrCreateRequestId } from "@/lib/requestId";
import { Business } from "@/models/Business";
import { Order } from "@/models/Order";

function sameLegacyPhone(inputPhone: string, orderPhone: string) {
  const normalizedInput = normalizePhone(inputPhone);
  const normalizedOrder = normalizePhone(orderPhone);
  if (!normalizedInput || !normalizedOrder) return false;
  return normalizedInput === normalizedOrder;
}

export async function GET(req: Request) {
  const requestId = getOrCreateRequestId(req);
  const withRequestId = <T extends Response>(response: T) =>
    attachRequestIdHeader(response, requestId);

  try {
    const url = new URL(req.url);
    const orderNumber = url.searchParams.get("orderNumber")?.trim() || "";
    const phoneInput = String(url.searchParams.get("phone") || "").trim();
    if (!orderNumber) return withRequestId(fail("VALIDATION_ERROR", "orderNumber is required."));

    await dbConnect();
    const order = await Order.findOne({ orderNumber }).lean();
    if (!order) return withRequestId(fail("NOT_FOUND", "Order not found.", 404));
    const business = await Business.findById((order as any).businessId)
      .select("name whatsapp phone eta deliveryPolicy")
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
      (business as { deliveryPolicy?: Record<string, unknown> }) || {}
    );
    const snapshotDelivery = (order as any)?.deliverySnapshot || null;
    const delivery = {
      mode:
        String(snapshotDelivery?.mode || "").trim() === "self_delivery"
          ? "self_delivery"
          : businessDeliveryInfo.mode,
      noteEs:
        String(snapshotDelivery?.noteEs || "").trim() || businessDeliveryInfo.publicNoteEs,
    };
    const normalizedPhone = normalizePhone(phoneInput);
    const phoneHash = normalizedPhone ? phoneToHash(normalizedPhone) : "";
    const orderPhoneHash = String((order as any)?.phoneHash || "").trim();
    const ownerByHash = Boolean(phoneHash) && orderPhoneHash && orderPhoneHash === phoneHash;
    const ownerByLegacy = !orderPhoneHash && sameLegacyPhone(phoneInput, String((order as any)?.phone || ""));
    const ownerMatches = ownerByHash || ownerByLegacy;

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
    const deliveryProof = {
      required,
      verifiedAt,
      otpLast4,
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
        contact,
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
      contact,
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
