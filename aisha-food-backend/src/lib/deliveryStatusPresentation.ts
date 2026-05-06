import { resolveOperationalOrderDeliveryMode, type DeliveryMode } from "@/lib/deliveryPolicy";

type DeliveryBusinessLike = {
  deliveryType?: string | null;
} | null | undefined;

type DeliveryOrderLike = {
  status?: string | null;
  eta?: {
    text?: string | null;
    minMins?: number | null;
    maxMins?: number | null;
  } | null;
  deliverySnapshot?: {
    mode?: string | null;
  } | null;
  dispatch?: {
    driverDispatchStatus?: string | null;
    assignedDriverId?: unknown;
    assignedDriverName?: string | null;
    assignedAt?: Date | string | null;
    currentOfferDriverId?: unknown;
    offerExpiresAt?: Date | string | null;
    driverArrivedAt?: Date | string | null;
    pickupConfirmedAt?: Date | string | null;
    arrivedAtCustomerAt?: Date | string | null;
    paymentCollectedAt?: Date | string | null;
    deliveredConfirmedAt?: Date | string | null;
  } | null;
  merchantDelivery?: {
    riderName?: string | null;
    riderPhone?: string | null;
    assignedAt?: Date | string | null;
  } | null;
};

export type MerchantDeliveryUi = {
  audience: "merchant";
  deliveryMode: DeliveryMode;
  modeLabel: string;
  handoffKey:
    | "self_delivery"
    | "preparing_dispatch"
    | "waiting_driver_assignment"
    | "driver_assigned"
    | "driver_arrived"
    | "picked_up"
    | "delivered"
    | "cancelled";
  handoffLabel: string;
  handoffHint: string | null;
  driverAssigned: boolean;
  pickupConfirmed: boolean;
  outForDelivery: boolean;
  delivered: boolean;
};

export type CustomerDeliveryUi = {
  audience: "customer";
  deliveryMode: DeliveryMode;
  stageKey:
    | "pending_payment"
    | "order_confirmed"
    | "being_prepared"
    | "waiting_driver"
    | "driver_assigned"
    | "out_for_delivery"
    | "arriving_soon"
    | "delivered"
    | "cancelled";
  stageLabel: string;
  stageHint: string | null;
  progressPct: number;
  driverAssigned: boolean;
  pickupConfirmed: boolean;
  outForDelivery: boolean;
  arrivingSoon: boolean;
};

export type DriverDeliveryUi = {
  audience: "driver";
  deliveryMode: DeliveryMode;
  stageKey:
    | "available"
    | "assigned"
    | "heading_to_pickup"
    | "at_restaurant"
    | "picked_up"
    | "at_customer"
    | "payment_collected"
    | "delivered"
    | "cancelled";
  stageLabel: string;
  stageHint: string | null;
};

function normalize(value: unknown) {
  return String(value || "").trim();
}

function normalizeStatus(value: unknown) {
  return normalize(value).toLowerCase() || "new";
}

function hasAssignedPlatformDriver(order: DeliveryOrderLike) {
  return Boolean(order?.dispatch?.assignedDriverId) || Boolean(normalize(order?.dispatch?.assignedDriverName));
}

function hasActiveDriverOffer(order: DeliveryOrderLike) {
  if (!order?.dispatch?.currentOfferDriverId) return false;
  if (!order?.dispatch?.offerExpiresAt) return false;
  const expiresAt = new Date(order.dispatch.offerExpiresAt);
  if (Number.isNaN(expiresAt.getTime())) return false;
  return expiresAt.getTime() > Date.now();
}

function hasMerchantRider(order: DeliveryOrderLike) {
  return (
    Boolean(order?.merchantDelivery?.assignedAt) ||
    Boolean(normalize(order?.merchantDelivery?.riderName)) ||
    Boolean(normalize(order?.merchantDelivery?.riderPhone))
  );
}

function hasPickupConfirmation(order: DeliveryOrderLike) {
  const status = normalizeStatus(order?.status);
  return Boolean(order?.dispatch?.pickupConfirmedAt) || status === "out_for_delivery" || status === "delivered";
}

function hasDriverArrivedAtRestaurant(order: DeliveryOrderLike) {
  return Boolean(order?.dispatch?.driverArrivedAt);
}

function hasDriverArrivedAtCustomer(order: DeliveryOrderLike) {
  return Boolean(order?.dispatch?.arrivedAtCustomerAt);
}

function hasPaymentCollected(order: DeliveryOrderLike) {
  return Boolean(order?.dispatch?.paymentCollectedAt);
}

function deriveEtaMinutes(order: DeliveryOrderLike) {
  const min = Number(order?.eta?.minMins || 0);
  const max = Number(order?.eta?.maxMins || 0);
  if (min > 0 && max > 0) return Math.round((min + max) / 2);
  if (max > 0) return Math.round(max);
  if (min > 0) return Math.round(min);
  return null;
}

function isArrivingSoon(order: DeliveryOrderLike) {
  if (hasDriverArrivedAtCustomer(order)) return true;
  if (normalizeStatus(order?.status) !== "out_for_delivery") return false;
  const etaMinutes = deriveEtaMinutes(order);
  return typeof etaMinutes === "number" && etaMinutes > 0 && etaMinutes <= 10;
}

export function getDeliveryModePresentation(
  order: DeliveryOrderLike | null | undefined,
  business?: DeliveryBusinessLike
) {
  const deliveryMode = resolveOperationalOrderDeliveryMode(order, business);
  const driverAssigned = deliveryMode === "platform_driver" && hasAssignedPlatformDriver(order || {});
  const driverOfferActive = deliveryMode === "platform_driver" && hasActiveDriverOffer(order || {});
  const merchantRiderAssigned = deliveryMode === "self_delivery" && hasMerchantRider(order || {});
  const pickupConfirmed = deliveryMode === "platform_driver" && hasPickupConfirmation(order || {});
  const driverArrivedAtRestaurant =
    deliveryMode === "platform_driver" && hasDriverArrivedAtRestaurant(order || {});
  const driverArrivedAtCustomer =
    deliveryMode === "platform_driver" && hasDriverArrivedAtCustomer(order || {});
  const paymentCollected =
    deliveryMode === "platform_driver" && hasPaymentCollected(order || {});
  const status = normalizeStatus(order?.status);

  return {
    status,
    deliveryMode,
    driverAssigned,
    driverOfferActive,
    merchantRiderAssigned,
    pickupConfirmed,
    driverArrivedAtRestaurant,
    driverArrivedAtCustomer,
    paymentCollected,
    delivered: status === "delivered",
    cancelled: status === "cancelled",
    outForDelivery: status === "out_for_delivery",
    arrivingSoon: isArrivingSoon(order || {}),
  };
}

export function getMerchantDeliveryUi(
  order: DeliveryOrderLike | null | undefined,
  business?: DeliveryBusinessLike
): MerchantDeliveryUi {
  const shared = getDeliveryModePresentation(order, business);

  if (shared.deliveryMode === "self_delivery") {
    return {
      audience: "merchant",
      deliveryMode: shared.deliveryMode,
      modeLabel: "Self delivery",
      handoffKey: shared.cancelled ? "cancelled" : "self_delivery",
      handoffLabel: shared.cancelled
        ? "Cancelled"
        : shared.outForDelivery || shared.delivered
          ? "Self-delivery in progress"
          : shared.merchantRiderAssigned
            ? "Rider assigned"
            : "Merchant-managed delivery",
      handoffHint: shared.cancelled
        ? "This order is no longer active."
        : shared.outForDelivery || shared.delivered
          ? "Keep managing this delivery through the merchant flow."
          : shared.merchantRiderAssigned
            ? "Your rider assignment remains the source of truth for this order."
            : "This order does not use platform-driver dispatch.",
      driverAssigned: false,
      pickupConfirmed: false,
      outForDelivery: shared.outForDelivery,
      delivered: shared.delivered,
    };
  }

  if (shared.cancelled) {
    return {
      audience: "merchant",
      deliveryMode: shared.deliveryMode,
      modeLabel: "Platform driver",
      handoffKey: "cancelled",
      handoffLabel: "Cancelled",
      handoffHint: "This order is no longer active in dispatch.",
      driverAssigned: shared.driverAssigned,
      pickupConfirmed: shared.pickupConfirmed,
      outForDelivery: shared.outForDelivery,
      delivered: shared.delivered,
    };
  }

  if (shared.delivered) {
    return {
      audience: "merchant",
      deliveryMode: shared.deliveryMode,
      modeLabel: "Platform driver",
      handoffKey: "delivered",
      handoffLabel: "Delivered",
      handoffHint: "Delivery was finalized through the platform-driver flow.",
      driverAssigned: shared.driverAssigned,
      pickupConfirmed: shared.pickupConfirmed,
      outForDelivery: shared.outForDelivery,
      delivered: shared.delivered,
    };
  }

  if (shared.outForDelivery || shared.pickupConfirmed) {
    return {
      audience: "merchant",
      deliveryMode: shared.deliveryMode,
      modeLabel: "Platform driver",
      handoffKey: "picked_up",
      handoffLabel: "Picked up / out for delivery",
      handoffHint: "The assigned driver has collected the order and is heading to the customer.",
      driverAssigned: shared.driverAssigned,
      pickupConfirmed: shared.pickupConfirmed,
      outForDelivery: shared.outForDelivery,
      delivered: shared.delivered,
    };
  }

  if (shared.driverAssigned && shared.driverArrivedAtRestaurant) {
    return {
      audience: "merchant",
      deliveryMode: shared.deliveryMode,
      modeLabel: "Platform driver",
      handoffKey: "driver_arrived",
      handoffLabel: "Driver arrived",
      handoffHint: "The assigned driver is at the business waiting for the handoff.",
      driverAssigned: shared.driverAssigned,
      pickupConfirmed: shared.pickupConfirmed,
      outForDelivery: shared.outForDelivery,
      delivered: shared.delivered,
    };
  }

  if (shared.driverAssigned) {
    return {
      audience: "merchant",
      deliveryMode: shared.deliveryMode,
      modeLabel: "Platform driver",
      handoffKey: "driver_assigned",
      handoffLabel: "Driver assigned",
      handoffHint:
        shared.status === "ready"
          ? "A driver is assigned and can pick up once the handoff is ready."
          : "A driver is assigned while the order is still being prepared.",
      driverAssigned: shared.driverAssigned,
      pickupConfirmed: shared.pickupConfirmed,
      outForDelivery: shared.outForDelivery,
      delivered: shared.delivered,
    };
  }

  if (shared.driverOfferActive || shared.status === "ready") {
    return {
      audience: "merchant",
      deliveryMode: shared.deliveryMode,
      modeLabel: "Platform driver",
      handoffKey: "waiting_driver_assignment",
      handoffLabel: shared.driverOfferActive ? "Offering to driver" : "Waiting for driver assignment",
      handoffHint: shared.driverOfferActive
        ? "The nearest available driver is being offered this order."
        : "Dispatch is waiting for a platform driver to accept the order.",
      driverAssigned: shared.driverAssigned,
      pickupConfirmed: shared.pickupConfirmed,
      outForDelivery: shared.outForDelivery,
      delivered: shared.delivered,
    };
  }

  return {
    audience: "merchant",
    deliveryMode: shared.deliveryMode,
    modeLabel: "Platform driver",
    handoffKey: "preparing_dispatch",
    handoffLabel: "Preparing for dispatch",
    handoffHint: "The order will become dispatch-ready once merchant preparation reaches handoff.",
    driverAssigned: shared.driverAssigned,
    pickupConfirmed: shared.pickupConfirmed,
    outForDelivery: shared.outForDelivery,
    delivered: shared.delivered,
  };
}

export function getCustomerDeliveryUi(
  order: DeliveryOrderLike | null | undefined,
  business?: DeliveryBusinessLike
): CustomerDeliveryUi {
  const shared = getDeliveryModePresentation(order, business);

  if (shared.status === "pending_payment") {
    return {
      audience: "customer",
      deliveryMode: shared.deliveryMode,
      stageKey: "pending_payment",
      stageLabel: "Paiement en attente",
      stageHint: "Finalize your online payment to confirm this order.",
      progressPct: 0,
      driverAssigned: false,
      pickupConfirmed: false,
      outForDelivery: false,
      arrivingSoon: false,
    };
  }

  if (shared.cancelled) {
    return {
      audience: "customer",
      deliveryMode: shared.deliveryMode,
      stageKey: "cancelled",
      stageLabel: "Cancelled",
      stageHint: "This order was cancelled.",
      progressPct: 100,
      driverAssigned: shared.driverAssigned,
      pickupConfirmed: shared.pickupConfirmed,
      outForDelivery: shared.outForDelivery,
      arrivingSoon: false,
    };
  }

  if (shared.delivered) {
    return {
      audience: "customer",
      deliveryMode: shared.deliveryMode,
      stageKey: "delivered",
      stageLabel: "Delivered",
      stageHint: "Your order was delivered successfully.",
      progressPct: 100,
      driverAssigned: shared.driverAssigned,
      pickupConfirmed: shared.pickupConfirmed,
      outForDelivery: shared.outForDelivery,
      arrivingSoon: false,
    };
  }

  if (shared.outForDelivery) {
    return {
      audience: "customer",
      deliveryMode: shared.deliveryMode,
      stageKey: shared.arrivingSoon ? "arriving_soon" : "out_for_delivery",
      stageLabel: shared.arrivingSoon ? "Arriving soon" : "Out for delivery",
      stageHint: shared.deliveryMode === "platform_driver"
        ? "Your driver picked up the order and is on the way."
        : "Your delivery is on the way.",
      progressPct: shared.arrivingSoon ? 92 : 85,
      driverAssigned: shared.driverAssigned,
      pickupConfirmed: shared.pickupConfirmed,
      outForDelivery: shared.outForDelivery,
      arrivingSoon: shared.arrivingSoon,
    };
  }

  if (
    shared.deliveryMode === "platform_driver" &&
    (shared.status === "ready" || shared.status === "preparing" || shared.status === "accepted") &&
    shared.driverAssigned
  ) {
    return {
      audience: "customer",
      deliveryMode: shared.deliveryMode,
      stageKey: "driver_assigned",
      stageLabel: "Driver assigned",
      stageHint: "A driver has been assigned and is heading to pickup.",
      progressPct: 70,
      driverAssigned: shared.driverAssigned,
      pickupConfirmed: shared.pickupConfirmed,
      outForDelivery: shared.outForDelivery,
      arrivingSoon: false,
    };
  }

  if (
    shared.deliveryMode === "platform_driver" &&
    (shared.driverOfferActive || shared.status === "ready")
  ) {
    return {
      audience: "customer",
      deliveryMode: shared.deliveryMode,
      stageKey: "waiting_driver",
      stageLabel: shared.driverOfferActive ? "Finding driver" : "Waiting for driver",
      stageHint: shared.driverOfferActive
        ? "We are offering your order to the nearest available driver."
        : "Your order is ready and waiting for a platform driver.",
      progressPct: shared.driverOfferActive ? 62 : 60,
      driverAssigned: shared.driverAssigned,
      pickupConfirmed: shared.pickupConfirmed,
      outForDelivery: shared.outForDelivery,
      arrivingSoon: false,
    };
  }

  if (shared.status === "accepted" || shared.status === "preparing" || shared.status === "ready") {
    return {
      audience: "customer",
      deliveryMode: shared.deliveryMode,
      stageKey: "being_prepared",
      stageLabel: "Being prepared",
      stageHint: "The business is preparing your order.",
      progressPct: shared.status === "accepted" ? 30 : shared.status === "preparing" ? 45 : 55,
      driverAssigned: shared.driverAssigned,
      pickupConfirmed: shared.pickupConfirmed,
      outForDelivery: shared.outForDelivery,
      arrivingSoon: false,
    };
  }

  return {
    audience: "customer",
    deliveryMode: shared.deliveryMode,
    stageKey: "order_confirmed",
    stageLabel: "Order confirmed",
    stageHint: "The business still needs to accept and start preparing your order.",
    progressPct: 10,
    driverAssigned: shared.driverAssigned,
    pickupConfirmed: shared.pickupConfirmed,
    outForDelivery: shared.outForDelivery,
    arrivingSoon: false,
  };
}

export function getDriverDeliveryUi(
  order: DeliveryOrderLike | null | undefined,
  business?: DeliveryBusinessLike
): DriverDeliveryUi {
  const shared = getDeliveryModePresentation(order, business);
  const assignmentType = shared.driverAssigned ? "assigned" : "available";

  if (shared.cancelled) {
    return {
      audience: "driver",
      deliveryMode: shared.deliveryMode,
      stageKey: "cancelled",
      stageLabel: "Cancelled",
      stageHint: "This delivery is no longer active.",
    };
  }

  if (shared.delivered) {
    return {
      audience: "driver",
      deliveryMode: shared.deliveryMode,
      stageKey: "delivered",
      stageLabel: "Delivered",
      stageHint: "Delivery finalization is complete.",
    };
  }

  if (shared.outForDelivery) {
    if (shared.driverArrivedAtCustomer) {
      return {
        audience: "driver",
        deliveryMode: shared.deliveryMode,
        stageKey: shared.paymentCollected ? "payment_collected" : "at_customer",
        stageLabel: shared.paymentCollected ? "Payment confirmed" : "At customer",
        stageHint: shared.paymentCollected
          ? "Final handoff can be completed."
          : "Confirm payment and handoff with the customer.",
      };
    }

    return {
      audience: "driver",
      deliveryMode: shared.deliveryMode,
      stageKey: "picked_up",
      stageLabel: "Out for delivery",
      stageHint: "Customer drop-off is the active step.",
    };
  }

  if (shared.driverAssigned) {
    if (shared.driverArrivedAtRestaurant) {
      return {
        audience: "driver",
        deliveryMode: shared.deliveryMode,
        stageKey: "at_restaurant",
        stageLabel: "At restaurant",
        stageHint: "Collect the order and confirm pickup when the handoff is complete.",
      };
    }

    return {
      audience: "driver",
      deliveryMode: shared.deliveryMode,
      stageKey: "heading_to_pickup",
      stageLabel: "Heading to pickup",
      stageHint: "Pickup handoff is the next operational step.",
    };
  }

  if (shared.driverOfferActive) {
    return {
      audience: "driver",
      deliveryMode: shared.deliveryMode,
      stageKey: "available",
      stageLabel: "Incoming order offer",
      stageHint: "Review the pickup and delivery details before the timer expires.",
    };
  }

  return {
    audience: "driver",
    deliveryMode: shared.deliveryMode,
    stageKey: assignmentType,
    stageLabel: assignmentType === "available" ? "Available to claim" : "Assigned",
    stageHint: assignmentType === "available"
      ? "This order can be accepted by an eligible platform driver."
      : "The order is assigned but not yet picked up.",
  };
}

export function getSafeCustomerDriverName(name: unknown) {
  const fullName = normalize(name);
  if (!fullName) return null;
  const firstName = fullName.split(/\s+/).filter(Boolean)[0] || "";
  return firstName || null;
}
