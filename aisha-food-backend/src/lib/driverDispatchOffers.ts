import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { estimateDispatchEtaMinutes, pickBestDriverForOrder, type RankedDriverRow } from "@/lib/smartDispatch";
import { sendDriverPushNotification } from "@/lib/driverPush";
import { Business } from "@/models/Business";
import { DispatchAudit } from "@/models/DispatchAudit";
import { Driver } from "@/models/Driver";
import { Order } from "@/models/Order";

export const PLATFORM_DRIVER_OFFER_STATUSES = ["accepted", "preparing", "ready"] as const;
export const DRIVER_OFFER_TTL_SECONDS = Math.max(
  20,
  Math.min(30, Number(process.env.DRIVER_OFFER_TTL_SECONDS || 25))
);

type DriverDispatchStatus =
  | "waiting_for_driver"
  | "offering_to_driver"
  | "driver_assigned"
  | "driver_accepted"
  | "no_driver_available";

type DispatchAttemptLean = {
  _id?: mongoose.Types.ObjectId | null;
  driverId?: mongoose.Types.ObjectId | null;
  driverName?: string | null;
  offeredAt?: Date | null;
  expiresAt?: Date | null;
  respondedAt?: Date | null;
  response?: string | null;
  reason?: string | null;
  score?: number | null;
  sameZone?: boolean | null;
  distanceKm?: number | null;
  zoneLabel?: string | null;
  via?: string | null;
};

type DispatchOrderLean = {
  _id: mongoose.Types.ObjectId;
  cityId?: mongoose.Types.ObjectId | null;
  businessId?: mongoose.Types.ObjectId | null;
  businessName?: string | null;
  orderNumber?: string | null;
  customerName?: string | null;
  address?: string | null;
  notes?: string | null;
  status?: string | null;
  total?: number | null;
  deliveryFeeToCustomer?: number | null;
  riderPayoutExpectedAtOrderTime?: number | null;
  currency?: string | null;
  payment?: {
    method?: string | null;
    status?: string | null;
    provider?: string | null;
  } | null;
  deliverySnapshot?: {
    mode?: string | null;
  } | null;
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
    pickupConfirmedAt?: Date | null;
    dispatchAttempts?: DispatchAttemptLean[] | null;
  } | null;
};

type DispatchBusinessLean = {
  _id: mongoose.Types.ObjectId;
  name?: string | null;
  address?: string | null;
  zoneLabel?: string | null;
  location?: {
    coordinates?: number[] | null;
  } | null;
} | null;

type DriverOfferLean = {
  _id: mongoose.Types.ObjectId;
  name?: string | null;
  zoneLabel?: string | null;
  pushToken?: string | null;
} | null;

type OfferResult = {
  ok: boolean;
  orderId: string;
  status:
    | "offered"
    | "existing_offer"
    | "already_assigned"
    | "not_dispatchable"
    | "no_driver_available";
  offer: Record<string, unknown> | null;
  driverId?: string | null;
  attemptId?: string | null;
  etaMinutes?: number | null;
  score?: number | null;
};

type OfferNextInput = {
  orderId: mongoose.Types.ObjectId | string;
  cityId: mongoose.Types.ObjectId | string;
  actor?: "system" | "ops" | "admin" | "merchant";
  source?: string;
  note?: string | null;
  excludeDriverIds?: Array<mongoose.Types.ObjectId | string>;
};

type ExpireOfferInput = {
  orderId: mongoose.Types.ObjectId | string;
  cityId: mongoose.Types.ObjectId | string;
  driverId?: mongoose.Types.ObjectId | string | null;
  actor?: "system" | "driver" | "ops" | "admin";
  source?: string;
  reason?: string | null;
  response?: "expired" | "rejected" | "released";
  triggerNext?: boolean;
};

function asObjectId(value: mongoose.Types.ObjectId | string) {
  return value instanceof mongoose.Types.ObjectId
    ? value
    : new mongoose.Types.ObjectId(String(value));
}

function normalizeText(value: unknown, max = 160) {
  return String(value || "").trim().slice(0, max);
}

function normalizeNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function extractCustomerArea(address: unknown) {
  const text = normalizeText(address, 240);
  if (!text) return null;
  const segments = text
    .split(",")
    .map((segment) => segment.trim())
    .filter(Boolean);
  return segments[0] || text;
}

function isOfferableStatus(status: unknown) {
  return PLATFORM_DRIVER_OFFER_STATUSES.includes(String(status || "") as (typeof PLATFORM_DRIVER_OFFER_STATUSES)[number]);
}

function isFutureDate(value: unknown, now = new Date()) {
  if (!value) return false;
  if (!(value instanceof Date) && typeof value !== "string" && typeof value !== "number") {
    return false;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return false;
  return parsed.getTime() > now.getTime();
}

function buildDispatchOfferResetSet(
  dispatchStatus: DriverDispatchStatus | null = null
): Record<string, unknown> {
  return {
    "dispatch.driverDispatchStatus": dispatchStatus,
    "dispatch.currentOfferDriverId": null,
    "dispatch.currentOfferAttemptId": null,
    "dispatch.currentOfferSentAt": null,
    "dispatch.offerExpiresAt": null,
    "dispatch.currentOfferDistanceKm": null,
  };
}

export function buildDispatchAssignmentSet(input: {
  driverId: mongoose.Types.ObjectId;
  driverName?: string | null;
  assignedAt: Date;
  dispatchStatus?: DriverDispatchStatus;
}) {
  return {
    ...buildDispatchOfferResetSet(input.dispatchStatus || "driver_accepted"),
    "dispatch.assignedDriverId": input.driverId,
    "dispatch.assignedDriverName": normalizeText(input.driverName, 80) || null,
    "dispatch.assignedAt": input.assignedAt,
  };
}

export function buildDispatchUnassignSet(
  dispatchStatus: DriverDispatchStatus | null = "waiting_for_driver"
) {
  return {
    ...buildDispatchOfferResetSet(dispatchStatus),
    "dispatch.assignedDriverId": null,
    "dispatch.assignedDriverName": null,
    "dispatch.assignedAt": null,
  };
}

function isCurrentOfferActive(order: DispatchOrderLean, now = new Date()) {
  return (
    !order.dispatch?.assignedDriverId &&
    Boolean(order.dispatch?.currentOfferDriverId) &&
    isFutureDate(order.dispatch?.offerExpiresAt, now) &&
    isOfferableStatus(order.status)
  );
}

function getRejectedDriverIds(order: DispatchOrderLean, extra: Array<mongoose.Types.ObjectId | string> = []) {
  const ids = new Set<string>();
  for (const driverId of extra) {
    const id = String(driverId || "").trim();
    if (id) ids.add(id);
  }

  for (const attempt of Array.isArray(order.dispatch?.dispatchAttempts)
    ? order.dispatch?.dispatchAttempts || []
    : []) {
    const response = String(attempt?.response || "").trim();
    const driverId = String(attempt?.driverId || "").trim();
    if (!driverId) continue;
    if (response === "rejected" || response === "expired" || response === "released") {
      ids.add(driverId);
    }
  }

  return Array.from(ids);
}

function resolveEstimatedEarning(order: DispatchOrderLean) {
  const payout = normalizeNumber(order.riderPayoutExpectedAtOrderTime);
  if (typeof payout === "number" && payout > 0) return payout;
  const deliveryFee = normalizeNumber(order.deliveryFeeToCustomer);
  if (typeof deliveryFee === "number" && deliveryFee > 0) return deliveryFee;
  return 0;
}

function shouldCollectAmount(order: DispatchOrderLean) {
  const method = normalizeText(order.payment?.method, 40).toLowerCase();
  const status = normalizeText(order.payment?.status, 40).toLowerCase();
  if (method === "cash") return true;
  if (
    (method === "mobile_money" ||
      method === "orange_money" ||
      method === "wave" ||
      method === "moov_money") &&
    status !== "paid"
  ) {
    return true;
  }
  return false;
}

async function loadDispatchOrder(input: {
  orderId: mongoose.Types.ObjectId;
  cityId: mongoose.Types.ObjectId;
}) {
  return Order.findOne({
    _id: input.orderId,
    cityId: input.cityId,
    "deliverySnapshot.mode": "platform_driver",
  })
    .select(
      [
        "_id",
        "cityId",
        "businessId",
        "businessName",
        "orderNumber",
        "customerName",
        "address",
        "notes",
        "status",
        "total",
        "deliveryFeeToCustomer",
        "riderPayoutExpectedAtOrderTime",
        "currency",
        "payment.method",
        "payment.status",
        "payment.provider",
        "deliverySnapshot.mode",
        "dispatch.driverDispatchStatus",
        "dispatch.assignedDriverId",
        "dispatch.assignedDriverName",
        "dispatch.assignedAt",
        "dispatch.currentOfferDriverId",
        "dispatch.currentOfferAttemptId",
        "dispatch.currentOfferSentAt",
        "dispatch.offerExpiresAt",
        "dispatch.currentOfferDistanceKm",
        "dispatch.pickupConfirmedAt",
        "dispatch.dispatchAttempts",
      ].join(" ")
    )
    .lean<DispatchOrderLean | null>();
}

async function loadBusinessForOffer(order: DispatchOrderLean) {
  if (!order.businessId || !mongoose.Types.ObjectId.isValid(String(order.businessId))) {
    return null;
  }

  return Business.findById(order.businessId)
    .select("_id name address zoneLabel location")
    .lean<DispatchBusinessLean>();
}

function findAttempt(order: DispatchOrderLean, attemptId?: mongoose.Types.ObjectId | null) {
  if (!attemptId) return null;
  return (
    (Array.isArray(order.dispatch?.dispatchAttempts) ? order.dispatch?.dispatchAttempts || [] : []).find(
      (attempt) => String(attempt?._id || "") === String(attemptId)
    ) || null
  );
}

function serializeDriverOffer(input: {
  order: DispatchOrderLean;
  business: DispatchBusinessLean;
  rank?: RankedDriverRow | null;
  driverId?: mongoose.Types.ObjectId | string | null;
}) {
  const now = new Date();
  const attempt = findAttempt(input.order, input.order.dispatch?.currentOfferAttemptId || null);
  const offerDriverId =
    input.order.dispatch?.currentOfferDriverId || input.driverId || attempt?.driverId || null;
  const expiresAt = input.order.dispatch?.offerExpiresAt || attempt?.expiresAt || null;
  const countdownSeconds = expiresAt
    ? Math.max(0, Math.ceil((new Date(expiresAt).getTime() - now.getTime()) / 1000))
    : 0;
  const estimatedDistanceKm =
    normalizeNumber(input.order.dispatch?.currentOfferDistanceKm) ??
    normalizeNumber(attempt?.distanceKm) ??
    normalizeNumber(input.rank?.distanceKm);
  const businessName =
    normalizeText(input.business?.name, 100) ||
    normalizeText(input.order.businessName, 100) ||
    "Restaurant";
  const pickupAddress =
    normalizeText(input.business?.address, 220) || normalizeText(input.order.businessName, 220);
  const customerAddress = normalizeText(input.order.address, 240);
  const customerArea = extractCustomerArea(customerAddress);

  return {
    orderId: String(input.order._id),
    orderNumber: normalizeText(input.order.orderNumber, 40) || String(input.order._id),
    deliveryMode: "platform_driver",
    driverDispatchStatus:
      normalizeText(input.order.dispatch?.driverDispatchStatus, 40) || "offering_to_driver",
    businessName,
    restaurantName: businessName,
    pickupAddress,
    customerName: normalizeText(input.order.customerName, 100) || "Customer",
    customerAddress,
    customerArea,
    deliveryNotes: normalizeText(input.order.notes, 240) || null,
    estimatedDistanceKm,
    estimatedEarning: resolveEstimatedEarning(input.order),
    orderTotal: normalizeNumber(input.order.total) ?? 0,
    paymentMethod: normalizeText(input.order.payment?.method, 40) || "cash",
    paymentStatus: normalizeText(input.order.payment?.status, 40) || "pending",
    paymentProvider: normalizeText(input.order.payment?.provider, 80) || null,
    amountToCollect: shouldCollectAmount(input.order)
      ? normalizeNumber(input.order.total) ?? 0
      : 0,
    currency: normalizeText(input.order.currency, 8) || "CFA",
    offerExpiresAt: expiresAt,
    countdownSeconds,
    driverId: offerDriverId ? String(offerDriverId) : null,
    attemptId: attempt?._id ? String(attempt._id) : null,
    canAccept: countdownSeconds > 0,
  };
}

async function auditDispatch(input: {
  cityId: mongoose.Types.ObjectId;
  order: DispatchOrderLean;
  driverId?: mongoose.Types.ObjectId | null;
  actor: "system" | "driver" | "ops" | "admin" | "merchant";
  action: string;
  meta?: Record<string, unknown>;
}) {
  await DispatchAudit.create({
    cityId: input.cityId,
    orderId: input.order._id,
    businessId: input.order.businessId || null,
    driverId: input.driverId || null,
    action: input.action,
    actor: input.actor === "system" ? "ops" : input.actor,
    meta: {
      cityId: input.cityId,
      driverId: input.driverId || null,
      selectedDriverId: input.driverId || null,
      ...(input.meta || {}),
    },
  }).catch((error) => {
    console.error("driver dispatch audit write failed", error);
  });
}

async function sendOfferPush(input: {
  driver: DriverOfferLean;
  offer: ReturnType<typeof serializeDriverOffer>;
}) {
  const bodyArea = normalizeText(input.offer.customerArea || input.offer.customerAddress, 80) || "customer drop-off";
  await sendDriverPushNotification({
    pushToken: input.driver?.pushToken || null,
    title: "Nouvelle livraison AishaFood",
    body: `${input.offer.restaurantName} -> ${bodyArea}`,
    data: {
      type: "driver_offer",
      orderId: input.offer.orderId,
      attemptId: input.offer.attemptId,
    },
  });
}

export async function offerNextDriverForOrder(input: OfferNextInput): Promise<OfferResult> {
  await dbConnect();

  const cityId = asObjectId(input.cityId);
  const orderId = asObjectId(input.orderId);
  const actor = input.actor || "system";
  const source = normalizeText(input.source, 120) || "dispatch.auto_offer";
  const note = normalizeText(input.note, 200) || null;
  const now = new Date();

  const order = await loadDispatchOrder({ orderId, cityId });
  if (!order) {
    return {
      ok: false,
      orderId: String(orderId),
      status: "not_dispatchable",
      offer: null,
    };
  }

  if (order.dispatch?.assignedDriverId) {
    return {
      ok: true,
      orderId: String(order._id),
      status: "already_assigned",
      offer: null,
      driverId: String(order.dispatch.assignedDriverId),
    };
  }

  if (!isOfferableStatus(order.status) || order.dispatch?.pickupConfirmedAt) {
    return {
      ok: false,
      orderId: String(order._id),
      status: "not_dispatchable",
      offer: null,
    };
  }

  if (isCurrentOfferActive(order, now)) {
    const business = await loadBusinessForOffer(order);
    return {
      ok: true,
      orderId: String(order._id),
      status: "existing_offer",
      offer: serializeDriverOffer({ order, business }),
      driverId: order.dispatch?.currentOfferDriverId
        ? String(order.dispatch.currentOfferDriverId)
        : null,
      attemptId: order.dispatch?.currentOfferAttemptId
        ? String(order.dispatch.currentOfferAttemptId)
        : null,
    };
  }

  const business = await loadBusinessForOffer(order);
  const excludedDriverIds = getRejectedDriverIds(order, input.excludeDriverIds || []);
  const { bestDriver, ranked } = await pickBestDriverForOrder({
    cityId,
    order: {
      _id: order._id,
      businessId: order.businessId || null,
      businessZoneLabel: normalizeText(business?.zoneLabel, 80) || null,
      businessLocation:
        Array.isArray(business?.location?.coordinates) && business?.location?.coordinates?.length >= 2
          ? {
              lat: Number(business.location.coordinates[1]),
              lng: Number(business.location.coordinates[0]),
            }
          : null,
    },
    options: {
      excludeDriverIds: excludedDriverIds,
      requireZeroActiveLoad: true,
      preferNearest: true,
    },
  });

  if (!bestDriver) {
    await Order.updateOne(
      {
        _id: order._id,
        cityId,
        "dispatch.assignedDriverId": null,
      },
      {
        $set: {
          ...buildDispatchOfferResetSet("no_driver_available"),
        },
      }
    );

    await auditDispatch({
      cityId,
      order,
      actor,
      action: "AUTO_DRIVER_NO_MATCH",
      meta: {
        note,
        reason: "NO_AVAILABLE_DRIVER",
        source,
      },
    });

    return {
      ok: true,
      orderId: String(order._id),
      status: "no_driver_available",
      offer: null,
    };
  }

  const attemptId = new mongoose.Types.ObjectId();
  const selectedRank = ranked.find((row) => row.driverId === String(bestDriver._id)) || null;
  const expiresAt = new Date(now.getTime() + DRIVER_OFFER_TTL_SECONDS * 1000);

  const updated = await Order.findOneAndUpdate(
    {
      _id: order._id,
      cityId,
      "deliverySnapshot.mode": "platform_driver",
      "dispatch.assignedDriverId": null,
      status: { $in: [...PLATFORM_DRIVER_OFFER_STATUSES] },
      $or: [
        { "dispatch.currentOfferDriverId": null },
        { "dispatch.offerExpiresAt": null },
        { "dispatch.offerExpiresAt": { $lte: now } },
      ],
    },
    {
      $set: {
        "dispatch.driverDispatchStatus": "offering_to_driver",
        "dispatch.currentOfferDriverId": bestDriver._id,
        "dispatch.currentOfferAttemptId": attemptId,
        "dispatch.currentOfferSentAt": now,
        "dispatch.offerExpiresAt": expiresAt,
        "dispatch.currentOfferDistanceKm": selectedRank?.distanceKm ?? null,
      },
      $push: {
        "dispatch.dispatchAttempts": {
          _id: attemptId,
          driverId: bestDriver._id,
          driverName: normalizeText(bestDriver.name, 80) || null,
          offeredAt: now,
          expiresAt,
          respondedAt: null,
          response: "offered",
          reason: null,
          score: selectedRank?.score ?? null,
          sameZone: Boolean(selectedRank?.sameZone),
          distanceKm: selectedRank?.distanceKm ?? null,
          zoneLabel: normalizeText(bestDriver.zoneLabel, 80) || null,
          via: "auto_dispatch",
        },
      },
    },
    { new: true }
  ).lean<DispatchOrderLean | null>();

  if (!updated) {
    const refreshed = await loadDispatchOrder({ orderId, cityId });
    if (refreshed && isCurrentOfferActive(refreshed, now)) {
      const refreshedBusiness = await loadBusinessForOffer(refreshed);
      return {
        ok: true,
        orderId: String(refreshed._id),
        status: "existing_offer",
        offer: serializeDriverOffer({ order: refreshed, business: refreshedBusiness }),
        driverId: refreshed.dispatch?.currentOfferDriverId
          ? String(refreshed.dispatch.currentOfferDriverId)
          : null,
        attemptId: refreshed.dispatch?.currentOfferAttemptId
          ? String(refreshed.dispatch.currentOfferAttemptId)
          : null,
      };
    }

    return {
      ok: false,
      orderId: String(order._id),
      status: "not_dispatchable",
      offer: null,
    };
  }

  const offer = serializeDriverOffer({
    order: updated,
    business,
    rank: selectedRank,
    driverId: bestDriver._id,
  });
  const etaMinutes = estimateDispatchEtaMinutes({
    activeLoad: Number(selectedRank?.activeLoad || 0),
    sameZone: Boolean(selectedRank?.sameZone),
    distanceKm: selectedRank?.distanceKm ?? null,
  });

  await auditDispatch({
    cityId,
    order: updated,
    driverId: bestDriver._id,
    actor,
    action: "AUTO_DRIVER_OFFERED",
    meta: {
      note,
      source,
      etaMinutes,
      score: selectedRank?.score ?? null,
      rankedTop5: ranked.slice(0, 5),
      offerExpiresAt: expiresAt,
    },
  });

  const driver = await Driver.findById(bestDriver._id)
    .select("_id name zoneLabel pushToken")
    .lean<DriverOfferLean>();
  await sendOfferPush({ driver, offer });

  return {
    ok: true,
    orderId: String(updated._id),
    status: "offered",
    offer,
    driverId: String(bestDriver._id),
    attemptId: String(attemptId),
    etaMinutes,
    score: selectedRank?.score ?? null,
  };
}

export async function startAutomaticDriverDispatch(input: OfferNextInput) {
  await Order.updateOne(
    {
      _id: asObjectId(input.orderId),
      cityId: asObjectId(input.cityId),
      "deliverySnapshot.mode": "platform_driver",
      "dispatch.assignedDriverId": null,
      status: { $in: [...PLATFORM_DRIVER_OFFER_STATUSES] },
    },
    {
      $set: {
        "dispatch.driverDispatchStatus": "waiting_for_driver",
      },
    }
  ).catch(() => null);

  return offerNextDriverForOrder({
    ...input,
    source: input.source || "dispatch.start",
  });
}

export async function expireDriverOfferForOrder(input: ExpireOfferInput) {
  await dbConnect();

  const cityId = asObjectId(input.cityId);
  const orderId = asObjectId(input.orderId);
  const actor = input.actor || "system";
  const now = new Date();
  const reason = normalizeText(input.reason, 120) || "offer_timeout";
  const response = input.response || "expired";
  const source = normalizeText(input.source, 120) || "driver.offer.expire";

  const currentOrder = await loadDispatchOrder({ orderId, cityId });
  if (!currentOrder || !currentOrder.dispatch?.currentOfferDriverId || currentOrder.dispatch?.assignedDriverId) {
    return {
      ok: true,
      orderId: String(orderId),
      expired: false,
      nextOffer: null,
    };
  }

  if (input.driverId && String(currentOrder.dispatch.currentOfferDriverId) !== String(input.driverId)) {
    return {
      ok: false,
      orderId: String(orderId),
      expired: false,
      nextOffer: null,
    };
  }

  const currentOfferAttemptId = currentOrder.dispatch?.currentOfferAttemptId || null;
  const currentDriverId = currentOrder.dispatch?.currentOfferDriverId || null;
  const update = await Order.findOneAndUpdate(
    {
      _id: currentOrder._id,
      cityId,
      "dispatch.assignedDriverId": null,
      "dispatch.currentOfferDriverId": currentDriverId,
      status: { $in: [...PLATFORM_DRIVER_OFFER_STATUSES] },
    },
    {
      $set: {
        ...buildDispatchOfferResetSet("waiting_for_driver"),
        ...(currentOfferAttemptId
          ? {
              "dispatch.dispatchAttempts.$[offer].respondedAt": now,
              "dispatch.dispatchAttempts.$[offer].response": response,
              "dispatch.dispatchAttempts.$[offer].reason": reason,
            }
          : {}),
      },
    },
    currentOfferAttemptId
      ? {
          new: true,
          arrayFilters: [
            {
              "offer._id": currentOfferAttemptId,
              "offer.response": "offered",
            },
          ],
        }
      : { new: true }
  ).lean<DispatchOrderLean | null>();

  if (!update) {
    return {
      ok: true,
      orderId: String(orderId),
      expired: false,
      nextOffer: null,
    };
  }

  await auditDispatch({
    cityId,
    order: update,
    driverId: currentDriverId,
    actor,
    action: response === "rejected" ? "AUTO_DRIVER_OFFER_REJECTED" : "AUTO_DRIVER_OFFER_EXPIRED",
    meta: {
      reason,
      note: reason,
      source,
      offerAttemptId: currentOfferAttemptId,
    },
  });

  if (input.triggerNext === false) {
    return {
      ok: true,
      orderId: String(orderId),
      expired: true,
      nextOffer: null,
    };
  }

  const next = await offerNextDriverForOrder({
    orderId,
    cityId,
    actor: actor === "driver" ? "system" : actor,
    source: `${source}.next`,
    note: reason,
    excludeDriverIds: currentDriverId ? [currentDriverId] : [],
  });

  return {
    ok: true,
    orderId: String(orderId),
    expired: true,
    nextOffer: next.offer,
    nextStatus: next.status,
  };
}

export async function loadCurrentDriverOffer(input: {
  cityId: mongoose.Types.ObjectId | string;
  driverId: mongoose.Types.ObjectId | string;
}) {
  await dbConnect();

  const cityId = asObjectId(input.cityId);
  const driverId = asObjectId(input.driverId);
  const now = new Date();
  const expired = await Order.findOne({
    cityId,
    "deliverySnapshot.mode": "platform_driver",
    status: { $in: [...PLATFORM_DRIVER_OFFER_STATUSES] },
    "dispatch.assignedDriverId": null,
    "dispatch.currentOfferDriverId": driverId,
    "dispatch.offerExpiresAt": { $lte: now },
  })
    .select("_id")
    .lean<{ _id: mongoose.Types.ObjectId } | null>();

  if (expired?._id) {
    await expireDriverOfferForOrder({
      orderId: expired._id,
      cityId,
      driverId,
      actor: "system",
      source: "driver.orders.current_offer.poll",
      reason: "offer_timeout",
      response: "expired",
      triggerNext: true,
    });
  }

  const order = await Order.findOne({
    cityId,
    "deliverySnapshot.mode": "platform_driver",
    status: { $in: [...PLATFORM_DRIVER_OFFER_STATUSES] },
    "dispatch.assignedDriverId": null,
    "dispatch.currentOfferDriverId": driverId,
    "dispatch.offerExpiresAt": { $gt: new Date() },
  })
    .select(
      [
        "_id",
        "cityId",
        "businessId",
        "businessName",
        "orderNumber",
        "customerName",
        "address",
        "notes",
        "status",
        "total",
        "deliveryFeeToCustomer",
        "riderPayoutExpectedAtOrderTime",
        "currency",
        "payment.method",
        "payment.status",
        "payment.provider",
        "deliverySnapshot.mode",
        "dispatch.driverDispatchStatus",
        "dispatch.currentOfferDriverId",
        "dispatch.currentOfferAttemptId",
        "dispatch.currentOfferSentAt",
        "dispatch.offerExpiresAt",
        "dispatch.currentOfferDistanceKm",
        "dispatch.dispatchAttempts",
      ].join(" ")
    )
    .lean<DispatchOrderLean | null>();

  if (!order) return null;

  const business = await loadBusinessForOffer(order);
  return serializeDriverOffer({
    order,
    business,
    driverId,
  });
}

export function orderVisibleAsCurrentOffer(input: {
  order: DispatchOrderLean | null | undefined;
  driverId: mongoose.Types.ObjectId | string;
  now?: Date;
}) {
  const order = input.order;
  if (!order) return false;
  if (order.dispatch?.assignedDriverId) return false;
  if (String(order.dispatch?.currentOfferDriverId || "") !== String(input.driverId)) return false;
  return isFutureDate(order.dispatch?.offerExpiresAt, input.now || new Date());
}
