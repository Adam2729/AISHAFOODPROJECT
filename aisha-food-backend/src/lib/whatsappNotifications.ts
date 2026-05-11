import mongoose from "mongoose";
import { normalizeDeliveryMode } from "@/lib/deliveryPolicy";
import {
  ENV_WHATSAPP_API_TOKEN,
  ENV_WHATSAPP_FROM_NUMBER,
  ENV_WHATSAPP_PROVIDER,
} from "@/lib/env";
import { NotificationEvent } from "@/models/NotificationEvent";

type NotificationAudience = "merchant" | "customer" | "driver";

type WhatsAppNotificationInput = {
  audience: NotificationAudience;
  eventType: string;
  title: string;
  body: string;
  orderId?: mongoose.Types.ObjectId | string | null;
  businessId?: mongoose.Types.ObjectId | string | null;
  cityId?: mongoose.Types.ObjectId | string | null;
  driverId?: mongoose.Types.ObjectId | string | null;
  customerPhoneHash?: string | null;
  deliveryMode?: string | null;
  source?: string | null;
  dedupeSuffix?: string | null;
  meta?: Record<string, unknown> | null;
};

type BaseOrderNotificationInput = {
  orderId: mongoose.Types.ObjectId | string;
  orderNumber?: string | null;
  businessId?: mongoose.Types.ObjectId | string | null;
  businessName?: string | null;
  cityId?: mongoose.Types.ObjectId | string | null;
  driverId?: mongoose.Types.ObjectId | string | null;
  customerPhoneHash?: string | null;
  deliveryMode?: string | null;
  source?: string | null;
  meta?: Record<string, unknown> | null;
};

function normalizeText(value: unknown, max = 500) {
  return String(value || "").trim().slice(0, max);
}

function displayCurrencyLabel(value: unknown) {
  const normalized = normalizeText(value, 16).toUpperCase();
  if (normalized === "XOF" || normalized === "CFA" || normalized === "FCFA") {
    return "FCFA";
  }
  return normalized || "FCFA";
}

function asObjectIdOrNull(value: mongoose.Types.ObjectId | string | null | undefined) {
  if (!value) return null;
  const normalized = String(value).trim();
  return mongoose.Types.ObjectId.isValid(normalized)
    ? new mongoose.Types.ObjectId(normalized)
    : null;
}

function buildDedupeKey(input: WhatsAppNotificationInput) {
  const identity =
    normalizeText(input.orderId, 80) ||
    normalizeText(input.driverId, 80) ||
    normalizeText(input.businessId, 80) ||
    "general";
  const suffix = normalizeText(input.dedupeSuffix, 80) || "base";
  return ["whatsapp", input.audience, input.eventType, identity, suffix].join(":");
}

function orderReference(orderNumber: unknown) {
  const normalized = normalizeText(orderNumber, 40);
  return normalized || "your order";
}

async function queueWhatsAppNotificationEvent(input: WhatsAppNotificationInput) {
  const deliveryMode = normalizeDeliveryMode(input.deliveryMode, "self_delivery");
  const dedupeKey = buildDedupeKey(input);

  await NotificationEvent.updateOne(
    { dedupeKey },
    {
      $setOnInsert: {
        dedupeKey,
        audience: input.audience,
        eventType: normalizeText(input.eventType, 80),
        status: "pending",
        cityId: asObjectIdOrNull(input.cityId),
        businessId: asObjectIdOrNull(input.businessId),
        orderId: asObjectIdOrNull(input.orderId),
        driverId: asObjectIdOrNull(input.driverId),
        customerPhoneHash: normalizeText(input.customerPhoneHash, 120) || null,
        deliveryMode,
        title: normalizeText(input.title, 160),
        body: normalizeText(input.body, 500),
        suggestedChannels: ["whatsapp"],
        source: normalizeText(input.source, 120) || null,
        meta: input.meta || null,
      },
    },
    { upsert: true }
  );

  if (!ENV_WHATSAPP_PROVIDER || !ENV_WHATSAPP_API_TOKEN || !ENV_WHATSAPP_FROM_NUMBER) {
    console.warn(
      JSON.stringify({
        type: "whatsapp_notification_unconfigured",
        provider: ENV_WHATSAPP_PROVIDER || null,
        eventType: input.eventType,
        audience: input.audience,
        timestamp: new Date().toISOString(),
      })
    );
    return;
  }

  console.info(
    JSON.stringify({
      type: "whatsapp_notification_placeholder",
      provider: ENV_WHATSAPP_PROVIDER,
      from: ENV_WHATSAPP_FROM_NUMBER,
      eventType: input.eventType,
      audience: input.audience,
      timestamp: new Date().toISOString(),
    })
  );
}

export async function queueOrderConfirmedWhatsApp(input: BaseOrderNotificationInput) {
  const reference = orderReference(input.orderNumber);
  await queueWhatsAppNotificationEvent({
    audience: "customer",
    eventType: "order_confirmed",
    title: "Order confirmed",
    body: `${reference} is confirmed and being prepared.`,
    orderId: input.orderId,
    businessId: input.businessId,
    cityId: input.cityId,
    driverId: input.driverId,
    customerPhoneHash: input.customerPhoneHash,
    deliveryMode: input.deliveryMode,
    source: input.source || "notifications.order_confirmed.whatsapp",
    dedupeSuffix: "order-confirmed",
    meta: input.meta,
  });
}

export async function queueDriverAssignedWhatsApp(input: BaseOrderNotificationInput) {
  const reference = orderReference(input.orderNumber);
  await Promise.all([
    queueWhatsAppNotificationEvent({
      audience: "merchant",
      eventType: "driver_assigned",
      title: "Driver assigned",
      body: `A driver has been assigned to ${reference}.`,
      orderId: input.orderId,
      businessId: input.businessId,
      cityId: input.cityId,
      driverId: input.driverId,
      customerPhoneHash: input.customerPhoneHash,
      deliveryMode: input.deliveryMode,
      source: input.source || "notifications.driver_assigned.whatsapp",
      dedupeSuffix: "driver-assigned-merchant",
      meta: input.meta,
    }),
    queueWhatsAppNotificationEvent({
      audience: "customer",
      eventType: "driver_assigned",
      title: "Driver assigned",
      body: `A driver has been assigned to ${reference}.`,
      orderId: input.orderId,
      businessId: input.businessId,
      cityId: input.cityId,
      driverId: input.driverId,
      customerPhoneHash: input.customerPhoneHash,
      deliveryMode: input.deliveryMode,
      source: input.source || "notifications.driver_assigned.whatsapp",
      dedupeSuffix: "driver-assigned-customer",
      meta: input.meta,
    }),
  ]);
}

export async function queueOrderOnTheWayWhatsApp(input: BaseOrderNotificationInput) {
  const reference = orderReference(input.orderNumber);
  await Promise.all([
    queueWhatsAppNotificationEvent({
      audience: "merchant",
      eventType: "out_for_delivery",
      title: "Order on the way",
      body: `${reference} is out for delivery.`,
      orderId: input.orderId,
      businessId: input.businessId,
      cityId: input.cityId,
      driverId: input.driverId,
      customerPhoneHash: input.customerPhoneHash,
      deliveryMode: input.deliveryMode,
      source: input.source || "notifications.out_for_delivery.whatsapp",
      dedupeSuffix: "out-for-delivery-merchant",
      meta: input.meta,
    }),
    queueWhatsAppNotificationEvent({
      audience: "customer",
      eventType: "out_for_delivery",
      title: "Order on the way",
      body: `${reference} is on the way.`,
      orderId: input.orderId,
      businessId: input.businessId,
      cityId: input.cityId,
      driverId: input.driverId,
      customerPhoneHash: input.customerPhoneHash,
      deliveryMode: input.deliveryMode,
      source: input.source || "notifications.out_for_delivery.whatsapp",
      dedupeSuffix: "out-for-delivery-customer",
      meta: input.meta,
    }),
  ]);
}

export async function queueOrderDeliveredWhatsApp(input: BaseOrderNotificationInput) {
  const reference = orderReference(input.orderNumber);
  await Promise.all([
    queueWhatsAppNotificationEvent({
      audience: "merchant",
      eventType: "order_delivered",
      title: "Order delivered",
      body: `${reference} was delivered.`,
      orderId: input.orderId,
      businessId: input.businessId,
      cityId: input.cityId,
      driverId: input.driverId,
      customerPhoneHash: input.customerPhoneHash,
      deliveryMode: input.deliveryMode,
      source: input.source || "notifications.order_delivered.whatsapp",
      dedupeSuffix: "order-delivered-merchant",
      meta: input.meta,
    }),
    queueWhatsAppNotificationEvent({
      audience: "customer",
      eventType: "order_delivered",
      title: "Order delivered",
      body: `${reference} was delivered.`,
      orderId: input.orderId,
      businessId: input.businessId,
      cityId: input.cityId,
      driverId: input.driverId,
      customerPhoneHash: input.customerPhoneHash,
      deliveryMode: input.deliveryMode,
      source: input.source || "notifications.order_delivered.whatsapp",
      dedupeSuffix: "order-delivered-customer",
      meta: input.meta,
    }),
  ]);
}

export async function queueMerchantPayoutPaidWhatsApp(input: {
  settlementId: mongoose.Types.ObjectId | string;
  businessId?: mongoose.Types.ObjectId | string | null;
  cityId?: mongoose.Types.ObjectId | string | null;
  restaurantName?: string | null;
  currency?: string | null;
  netAmount?: number | null;
  payoutReference?: string | null;
  source?: string | null;
}) {
  const amountText = Number.isFinite(Number(input.netAmount))
    ? `${Number(input.netAmount).toLocaleString()} ${displayCurrencyLabel(input.currency)}`
    : "your settlement";
  await queueWhatsAppNotificationEvent({
    audience: "merchant",
    eventType: "payout_paid",
    title: "Settlement paid",
    body: `${normalizeText(input.restaurantName, 80) || "Merchant"} settlement paid: ${amountText}.`,
    businessId: input.businessId,
    cityId: input.cityId,
    source: input.source || "notifications.payout_paid.whatsapp",
    dedupeSuffix: `settlement-${String(input.settlementId)}`,
    meta: {
      payoutReference: normalizeText(input.payoutReference, 160) || null,
    },
  });
}

export async function queueDriverPayoutPaidWhatsApp(input: {
  requestId: mongoose.Types.ObjectId | string;
  driverId?: mongoose.Types.ObjectId | string | null;
  cityId?: mongoose.Types.ObjectId | string | null;
  driverName?: string | null;
  currency?: string | null;
  requestedAmount?: number | null;
  payoutReference?: string | null;
  source?: string | null;
}) {
  const amountText = Number.isFinite(Number(input.requestedAmount))
    ? `${Number(input.requestedAmount).toLocaleString()} ${displayCurrencyLabel(input.currency)}`
    : "your payout";
  await queueWhatsAppNotificationEvent({
    audience: "driver",
    eventType: "payout_paid",
    title: "Driver payout paid",
    body: `${normalizeText(input.driverName, 80) || "Driver"} payout paid: ${amountText}.`,
    driverId: input.driverId,
    cityId: input.cityId,
    source: input.source || "notifications.driver_payout_paid.whatsapp",
    dedupeSuffix: `driver-payout-${String(input.requestId)}`,
    meta: {
      payoutReference: normalizeText(input.payoutReference, 160) || null,
    },
  });
}
