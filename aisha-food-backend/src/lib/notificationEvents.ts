import mongoose from "mongoose";
import { normalizeDeliveryMode, type DeliveryMode } from "@/lib/deliveryPolicy";
import { NotificationEvent } from "@/models/NotificationEvent";

type NotificationAudience = "merchant" | "customer";
type SuggestedChannel = "in_app" | "push" | "whatsapp" | "email";

type QueueNotificationInput = {
  audience: NotificationAudience;
  eventType: string;
  orderId: mongoose.Types.ObjectId | string;
  businessId?: mongoose.Types.ObjectId | string | null;
  cityId?: mongoose.Types.ObjectId | string | null;
  driverId?: mongoose.Types.ObjectId | string | null;
  customerPhoneHash?: string | null;
  deliveryMode?: string | null;
  title: string;
  body: string;
  source?: string | null;
  dedupeSuffix?: string | null;
  suggestedChannels?: SuggestedChannel[];
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

function asObjectIdOrNull(value: mongoose.Types.ObjectId | string | null | undefined) {
  if (!value) return null;
  const normalized = String(value).trim();
  return mongoose.Types.ObjectId.isValid(normalized)
    ? new mongoose.Types.ObjectId(normalized)
    : null;
}

function buildDedupeKey(input: QueueNotificationInput) {
  const suffix = normalizeText(input.dedupeSuffix, 60) || "base";
  return [
    normalizeText(input.audience, 20),
    normalizeText(input.eventType, 80),
    normalizeText(input.orderId, 80),
    suffix,
  ].join(":");
}

function notificationChannels(
  audience: NotificationAudience,
  deliveryMode: DeliveryMode
): SuggestedChannel[] {
  if (audience === "merchant") {
    return deliveryMode === "platform_driver"
      ? ["in_app", "whatsapp"]
      : ["in_app"];
  }
  return deliveryMode === "platform_driver"
    ? ["in_app", "push", "whatsapp"]
    : ["in_app", "push"];
}

async function queueNotificationEvent(input: QueueNotificationInput) {
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
        suggestedChannels:
          Array.isArray(input.suggestedChannels) && input.suggestedChannels.length
            ? input.suggestedChannels
            : notificationChannels(input.audience, deliveryMode),
        source: normalizeText(input.source, 120) || null,
        meta: input.meta || null,
      },
    },
    { upsert: true }
  );
}

export async function settleNotificationWrites(
  source: string,
  writes: Array<Promise<unknown>>,
  context?: Record<string, unknown> | null
) {
  if (!Array.isArray(writes) || !writes.length) return;
  const settled = await Promise.allSettled(writes);
  for (const result of settled) {
    if (result.status === "fulfilled") continue;
    console.error(
      JSON.stringify({
        type: "notification_queue_error",
        source: normalizeText(source, 120) || "unknown",
        error:
          result.reason instanceof Error
            ? result.reason.message
            : "Failed to queue notification event",
        ...(context || {}),
        timestamp: new Date().toISOString(),
      })
    );
  }
}

async function queuePair(
  input: BaseOrderNotificationInput,
  merchantEvent: { eventType: string; title: string; body: string; dedupeSuffix?: string | null } | null,
  customerEvent: { eventType: string; title: string; body: string; dedupeSuffix?: string | null } | null
) {
  const writes: Promise<unknown>[] = [];
  if (merchantEvent) {
    writes.push(
      queueNotificationEvent({
        audience: "merchant",
        eventType: merchantEvent.eventType,
        orderId: input.orderId,
        businessId: input.businessId,
        cityId: input.cityId,
        driverId: input.driverId,
        customerPhoneHash: input.customerPhoneHash,
        deliveryMode: input.deliveryMode,
        title: merchantEvent.title,
        body: merchantEvent.body,
        source: input.source,
        dedupeSuffix: merchantEvent.dedupeSuffix,
        meta: input.meta,
      })
    );
  }
  if (customerEvent) {
    writes.push(
      queueNotificationEvent({
        audience: "customer",
        eventType: customerEvent.eventType,
        orderId: input.orderId,
        businessId: input.businessId,
        cityId: input.cityId,
        driverId: input.driverId,
        customerPhoneHash: input.customerPhoneHash,
        deliveryMode: input.deliveryMode,
        title: customerEvent.title,
        body: customerEvent.body,
        source: input.source,
        dedupeSuffix: customerEvent.dedupeSuffix,
        meta: input.meta,
      })
    );
  }
  if (!writes.length) return;
  await Promise.all(writes);
}

function orderReference(orderNumber: unknown) {
  const normalized = normalizeText(orderNumber, 40);
  return normalized || "your order";
}

export async function queueMerchantNewOrderNotification(input: BaseOrderNotificationInput) {
  const reference = orderReference(input.orderNumber);
  await queuePair(
    input,
    {
      eventType: "new_order",
      title: "New order received",
      body: `${normalizeText(input.businessName, 100) || "Your business"} received ${reference}.`,
      dedupeSuffix: "new-order",
    },
    null
  );
}

export async function queueCustomerOrderConfirmedNotification(input: BaseOrderNotificationInput) {
  const reference = orderReference(input.orderNumber);
  await queuePair(
    input,
    null,
    {
      eventType: "order_confirmed",
      title: "Order confirmed",
      body: `${reference} is confirmed and being prepared.`,
      dedupeSuffix: "order-confirmed",
    }
  );
}

export async function queueDriverAssignedNotifications(input: BaseOrderNotificationInput) {
  const reference = orderReference(input.orderNumber);
  await queuePair(
    input,
    {
      eventType: "driver_assigned",
      title: "Driver assigned",
      body: `A driver has been assigned to ${reference}.`,
      dedupeSuffix: "driver-assigned",
    },
    {
      eventType: "driver_assigned",
      title: "Driver assigned",
      body: `A driver has been assigned to ${reference}.`,
      dedupeSuffix: "driver-assigned",
    }
  );
}

export async function queueOutForDeliveryNotifications(input: BaseOrderNotificationInput) {
  const reference = orderReference(input.orderNumber);
  const deliveryMode = normalizeDeliveryMode(input.deliveryMode, "self_delivery");
  const merchantEvent =
    deliveryMode === "platform_driver"
      ? {
          eventType: "driver_picked_up",
          title: "Order picked up",
          body: `${reference} was picked up and is out for delivery.`,
          dedupeSuffix: "out-for-delivery",
        }
      : {
          eventType: "out_for_delivery",
          title: "Out for delivery",
          body: `${reference} is out for delivery.`,
          dedupeSuffix: "out-for-delivery",
        };
  await queuePair(
    input,
    merchantEvent,
    {
      eventType: "out_for_delivery",
      title: "Out for delivery",
      body: `${reference} is on the way.`,
      dedupeSuffix: "out-for-delivery",
    }
  );
}

export async function queueOrderDeliveredNotifications(input: BaseOrderNotificationInput) {
  const reference = orderReference(input.orderNumber);
  await queuePair(
    input,
    {
      eventType: "order_delivered",
      title: "Order delivered",
      body: `${reference} was delivered.`,
      dedupeSuffix: "order-delivered",
    },
    {
      eventType: "order_delivered",
      title: "Order delivered",
      body: `${reference} was delivered.`,
      dedupeSuffix: "order-delivered",
    }
  );
}

export async function queueDeliveryExceptionNotifications(
  input: BaseOrderNotificationInput & { reason?: string | null }
) {
  const reference = orderReference(input.orderNumber);
  const reason = normalizeText(input.reason, 80) || "delivery_issue";
  await queuePair(
    input,
    {
      eventType: "delivery_exception",
      title: "Delivery issue reported",
      body: `A delivery issue was reported for ${reference}.`,
      dedupeSuffix: `delivery-exception-${reason}`,
    },
    {
      eventType: "delivery_exception",
      title: "Delivery delay reported",
      body: `There is a delivery issue affecting ${reference}.`,
      dedupeSuffix: `delivery-exception-${reason}`,
    }
  );
}
