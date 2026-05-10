import { Schema, model, models } from "mongoose";
import { COMMISSION_RATE_DEFAULT } from "@/lib/constants";
import { PAYMENT_METHOD_VALUES, PAYMENT_STATUS_VALUES } from "@/lib/payment";

const OrderItemSchema = new Schema(
  {
    productId: { type: Schema.Types.ObjectId, ref: "Product", required: true },
    name: { type: String, required: true },
    productPrice: { type: Number, required: true, min: 0 },
    displaySize: { type: String, default: "", trim: true, maxlength: 40 },
    quantityValue: { type: Number, default: null, min: 0 },
    quantityUnit: { type: String, default: "", trim: true, maxlength: 20 },
    qty: { type: Number, required: true, min: 1 },
    unitPrice: { type: Number, required: true, min: 0 },
    lineTotal: { type: Number, required: true, min: 0 },
  },
  { _id: false }
);

const OrderCancellationSchema = new Schema(
  {
    reason: { type: String, default: null, trim: true, maxlength: 40 },
    note: { type: String, default: "", trim: true, maxlength: 280 },
    cancelledAt: { type: Date, default: null },
    cancelledBy: { type: String, default: null, trim: true, maxlength: 80 },
  },
  { _id: false }
);

const MerchantIssueSchema = new Schema(
  {
    issueType: { type: String, required: true, trim: true, maxlength: 40 },
    note: { type: String, default: "", trim: true, maxlength: 280 },
    createdBy: { type: String, default: "merchant", trim: true, maxlength: 80 },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const OrderAdjustmentSchema = new Schema(
  {
    adjustmentType: { type: String, required: true, trim: true, maxlength: 40 },
    amount: { type: Number, required: true, min: 0 },
    reason: { type: String, required: true, trim: true, maxlength: 140 },
    note: { type: String, default: "", trim: true, maxlength: 280 },
    createdBy: { type: String, required: true, trim: true, maxlength: 80 },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const OrderEventSchema = new Schema(
  {
    type: { type: String, required: true, trim: true, maxlength: 40 },
    label: { type: String, required: true, trim: true, maxlength: 120 },
    detail: { type: String, default: null, trim: true, maxlength: 280 },
    actor: { type: String, default: null, trim: true, maxlength: 80 },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const OrderDispatchAttemptSchema = new Schema(
  {
    driverId: { type: Schema.Types.ObjectId, ref: "Driver", required: true },
    driverName: { type: String, default: null, trim: true, maxlength: 80 },
    offeredAt: { type: Date, default: Date.now },
    expiresAt: { type: Date, default: null },
    respondedAt: { type: Date, default: null },
    response: {
      type: String,
      enum: ["offered", "accepted", "rejected", "expired", "released"],
      default: "offered",
    },
    reason: { type: String, default: null, trim: true, maxlength: 120 },
    score: { type: Number, default: null },
    sameZone: { type: Boolean, default: false },
    distanceKm: { type: Number, default: null, min: 0 },
    zoneLabel: { type: String, default: null, trim: true, maxlength: 80 },
    via: { type: String, default: "auto_dispatch", trim: true, maxlength: 40 },
  },
  { _id: true }
);

const OrderSchema = new Schema(
  {
    orderNumber: { type: String, required: true, unique: true, index: true },
    cityId: { type: Schema.Types.ObjectId, ref: "City", default: null, index: true },
    businessId: { type: Schema.Types.ObjectId, ref: "Business", required: true, index: true },
    businessName: { type: String, required: true },
    businessType: { type: String, enum: ["restaurant", "colmado"], required: true },

    customerName: { type: String, required: true },
    phone: { type: String, default: null },
    phoneHash: { type: String, default: "", index: true },
    sessionIdHash: { type: String, default: "", index: true },
    address: { type: String, required: true },
    notes: { type: String, default: "", trim: true, maxlength: 280 },
    customerLocation: {
      lat: { type: Number, required: true },
      lng: { type: Number, required: true },
    },

    items: { type: [OrderItemSchema], required: true, default: [] },

    subtotal: { type: Number, required: true, min: 0 },
    deliveryFeeToCustomer: { type: Number, default: 0 },
    total: { type: Number, required: true, min: 0 },
    orderTotal: { type: Number, required: true, min: 0 },
    commissionRate: { type: Number, default: COMMISSION_RATE_DEFAULT },
    commissionAmount: { type: Number, required: true, min: 0 },
    platformCommissionAmount: { type: Number, required: true, min: 0 },
    restaurantNetAmount: { type: Number, required: true, min: 0 },
    driverPayoutAmount: { type: Number, default: 0, min: 0 },
    commissionRateAtOrderTime: { type: Number, default: null },
    currency: { type: String, enum: ["DOP", "CFA", null], default: null },
    deliveryFeeModelAtOrderTime: {
      type: String,
      enum: ["restaurantPays", "customerPays", null],
      default: null,
    },
    deliveryFeeBandAtOrderTime: {
      minKm: { type: Number, default: null },
      maxKm: { type: Number, default: null },
      fee: { type: Number, default: null },
    },
    riderPayoutExpectedAtOrderTime: { type: Number, default: 0, min: 0 },

    payment: {
      method: { type: String, enum: [...PAYMENT_METHOD_VALUES], default: "cash" },
      status: {
        type: String,
        enum: [...PAYMENT_STATUS_VALUES, "unpaid"],
        default: "pending",
      },
      paidAt: { type: Date, default: null },
      provider: { type: String, default: null, trim: true, maxlength: 120 },
      reference: { type: String, default: null, trim: true, maxlength: 120 },
    },
    paymentStatus: {
      type: String,
      enum: [...PAYMENT_STATUS_VALUES, "unpaid"],
      default: "pending",
    }, // legacy shortcut
    paytechRefCommand: { type: String, default: null, trim: true, maxlength: 120, index: true },
    paytechTransactionId: { type: String, default: null, trim: true, maxlength: 120 },
    paytechPaymentUrl: { type: String, default: null, trim: true, maxlength: 800 },
    paytechRawStatus: { type: String, default: null, trim: true, maxlength: 120 },
    paytechWebhookReceivedAt: { type: Date, default: null },
    paytechWebhookPayload: { type: Schema.Types.Mixed, default: null },
    failedAt: { type: Date, default: null },
    promoCode: { type: String, default: null, trim: true, uppercase: true, maxlength: 64 },

    status: {
      type: String,
      enum: [
        "pending_payment",
        "new",
        "accepted",
        "preparing",
        "ready",
        "out_for_delivery",
        "delivered",
        "cancelled",
      ],
      default: "new",
      index: true,
    },
    cancelReason: { type: String, default: "" },
    cancellation: { type: OrderCancellationSchema, default: () => ({}) },
    merchantIssues: { type: [MerchantIssueSchema], default: [] },
    adjustments: { type: [OrderAdjustmentSchema], default: [] },
    orderEvents: { type: [OrderEventSchema], default: [] },
    benefitsApplied: { type: Boolean, default: false, index: true },

    discount: {
      source: { type: String, enum: ["promo", "wallet"], default: null },
      code: { type: String, default: null },
      promoId: { type: Schema.Types.ObjectId, ref: "Promo", default: null },
      promoCodeId: { type: Schema.Types.ObjectId, ref: "PromoCode", default: null },
      amount: { type: Number, default: 0, min: 0 },
      subtotalBefore: { type: Number, default: 0, min: 0 },
      subtotalAfter: { type: Number, default: 0, min: 0 },
    },

    referral: {
      usedCode: { type: String, default: null },
      referrerPhoneHash: { type: String, default: null },
      appliedNewCustomerBonus: { type: Number, default: null },
    },

    attribution: {
      source: {
        type: String,
        enum: ["organic", "whatsapp", "flyer", "merchant_referral"],
        default: "organic",
        index: true,
      },
      campaignId: { type: String, default: null },
    },

    eta: {
      minMins: { type: Number, default: 25, min: 5, max: 180 },
      maxMins: { type: Number, default: 40, min: 5, max: 240 },
      prepMins: { type: Number, default: 15, min: 0, max: 120 },
      text: { type: String, default: "25-40 min" },
    },
    deliverySnapshot: {
      mode: {
        type: String,
        enum: ["self_delivery", "platform_driver"],
        default: "self_delivery",
      },
      noteEs: { type: String, default: "Entrega manejada por el negocio", trim: true, maxlength: 120 },
    },

    settlement: {
      weekKey: { type: String, required: true, index: true },
      status: { type: String, enum: ["pending", "collected"], default: "pending" },
      counted: { type: Boolean, default: false },
      collectedAt: { type: Date, default: null },
      receiptRef: { type: String, default: "" },
      collectorName: { type: String, trim: true, maxlength: 60, default: "" },
      collectionMethod: { type: String, enum: ["cash", "transfer", "other"], default: "cash" },
      receiptPhotoUrl: { type: String, trim: true, maxlength: 500, default: "" },
    },

    sla: {
      firstActionAt: { type: Date, default: null },
      deliveredAt: { type: Date, default: null },
      firstActionMinutes: { type: Number, default: null },
      totalMinutes: { type: Number, default: null },
    },

    statusTimestamps: {
      acceptedAt: { type: Date, default: null },
    },

    dispatch: {
      driverDispatchStatus: {
        type: String,
        enum: [
          "waiting_for_driver",
          "offering_to_driver",
          "driver_assigned",
          "driver_accepted",
          "no_driver_available",
          "needs_manual_dispatch",
          null,
        ],
        default: null,
        index: true,
      },
      assignedDriverId: { type: Schema.Types.ObjectId, ref: "Driver", default: null },
      assignedDriverName: { type: String, default: null, trim: true, maxlength: 80 },
      assignedAt: { type: Date, default: null },
      currentOfferDriverId: { type: Schema.Types.ObjectId, ref: "Driver", default: null, index: true },
      currentOfferAttemptId: { type: Schema.Types.ObjectId, default: null },
      currentOfferSentAt: { type: Date, default: null },
      offerExpiresAt: { type: Date, default: null, index: true },
      currentOfferDistanceKm: { type: Number, default: null, min: 0 },
      driverArrivedAt: { type: Date, default: null },
      pickupConfirmedAt: { type: Date, default: null },
      arrivedAtCustomerAt: { type: Date, default: null },
      paymentCollectedAt: { type: Date, default: null },
      paymentCollectionMethod: { type: String, default: null, trim: true, maxlength: 40 },
      paymentCollectionProvider: { type: String, default: null, trim: true, maxlength: 80 },
      paymentCollectionReference: { type: String, default: null, trim: true, maxlength: 120 },
      paymentCollectionNote: { type: String, default: null, trim: true, maxlength: 200 },
      deliveredConfirmedAt: { type: Date, default: null },
      cashCollectedByDriver: { type: Boolean, default: false },
      handoffNote: { type: String, default: null, trim: true, maxlength: 200 },
      routeBatchId: { type: String, default: null, trim: true, maxlength: 80, index: true },
      routeSequence: { type: Number, default: null, min: 0 },
      currentStopIndex: { type: Number, default: null, min: 0 },
      dispatchAttempts: { type: [OrderDispatchAttemptSchema], default: [] },
    },
    merchantDelivery: {
      riderName: { type: String, default: null, trim: true, maxlength: 60 },
      riderPhone: { type: String, default: null, trim: true, maxlength: 30 },
      assignedAt: { type: Date, default: null },
    },
    deliveryProof: {
      required: { type: Boolean, default: true },
      otpHash: { type: String, default: null },
      otpLast4: { type: String, default: null },
      otpCreatedAt: { type: Date, default: null },
      failedAttempts: { type: Number, default: 0, min: 0 },
      lastFailedAt: { type: Date, default: null },
      verifiedAt: { type: Date, default: null },
      verifiedBy: {
        type: String,
        enum: ["customer_code", "admin_override", null],
        default: null,
      },
      note: { type: String, default: null, trim: true, maxlength: 280 },
      photoUrl: { type: String, default: null, trim: true, maxlength: 500 },
      capturedAt: { type: Date, default: null },
      capturedByDriverId: { type: Schema.Types.ObjectId, ref: "Driver", default: null },
    },
    deliveryException: {
      reason: {
        type: String,
        enum: [
          "customer_unreachable",
          "address_issue",
          "vehicle_issue",
          "merchant_delay",
          "safety_issue",
          "other",
          null,
        ],
        default: null,
      },
      note: { type: String, default: "", trim: true, maxlength: 280 },
      reportedAt: { type: Date, default: null },
      reportedByDriverId: { type: Schema.Types.ObjectId, ref: "Driver", default: null },
      status: { type: String, enum: ["open", "resolved", null], default: null, index: true },
      resolvedAt: { type: Date, default: null },
      resolvedBy: { type: String, default: null, trim: true, maxlength: 80 },
    },

    review: {
      rating: { type: Number, default: null, min: 1, max: 5 },
      reviewedAt: { type: Date, default: null },
    },
  },
  { timestamps: true }
);

const PROTECTED_FINANCIAL_PATH_PREFIXES = [
  "subtotal",
  "total",
  "orderTotal",
  "commissionRate",
  "commissionAmount",
  "platformCommissionAmount",
  "restaurantNetAmount",
  "driverPayoutAmount",
  "deliveryFeeToCustomer",
  "deliveryFeeModelAtOrderTime",
  "deliveryFeeBandAtOrderTime",
  "riderPayoutExpectedAtOrderTime",
  "items",
  "payment",
  "paymentStatus",
  "paytechRefCommand",
  "paytechTransactionId",
  "paytechPaymentUrl",
  "paytechRawStatus",
  "paytechWebhookReceivedAt",
  "paytechWebhookPayload",
  "failedAt",
  "promoCode",
  "discount",
  "settlement.weekKey",
  "settlement.counted",
  "settlement.status",
] as const;

function isProtectedPath(path: string) {
  const normalized = String(path || "").trim();
  if (!normalized) return false;
  return PROTECTED_FINANCIAL_PATH_PREFIXES.some((prefix) => {
    return (
      normalized === prefix ||
      normalized.startsWith(`${prefix}.`) ||
      normalized.startsWith(`${prefix}[`)
    );
  });
}

function flattenUpdateKeys(value: unknown, parent = ""): string[] {
  if (!value || typeof value !== "object") return [];
  const obj = value as Record<string, unknown>;
  const keys: string[] = [];
  for (const [key, nested] of Object.entries(obj)) {
    const path = parent ? `${parent}.${key}` : key;
    keys.push(path);
    if (
      nested &&
      typeof nested === "object" &&
      !Array.isArray(nested) &&
      !key.startsWith("$")
    ) {
      keys.push(...flattenUpdateKeys(nested, path));
    }
  }
  return keys;
}

function updateTouchesProtectedFields(update: unknown): boolean {
  return getProtectedPathsTouched(update).length > 0;
}

function getProtectedPathsTouched(update: unknown): string[] {
  if (!update || typeof update !== "object") return [];
  const updateObj = update as Record<string, unknown>;
  const touched = new Set<string>();

  for (const key of Object.keys(updateObj)) {
    if (key.startsWith("$")) continue;
    if (isProtectedPath(key)) touched.add(key);
    const nested = updateObj[key];
    if (nested && typeof nested === "object" && !Array.isArray(nested)) {
      const nestedPaths = flattenUpdateKeys(nested, key);
      for (const path of nestedPaths) {
        if (isProtectedPath(path)) touched.add(path);
      }
    }
  }

  const operators = ["$set", "$inc", "$unset", "$rename", "$setOnInsert", "$push", "$pull"];
  for (const operator of operators) {
    const payload = updateObj[operator];
    if (!payload || typeof payload !== "object") continue;
    const paths = flattenUpdateKeys(payload);
    for (const path of paths) {
      if (isProtectedPath(path)) touched.add(path);
    }
  }

  return Array.from(touched);
}

function extractRequestedStatus(update: unknown): string | null {
  if (!update || typeof update !== "object") return null;
  const updateObj = update as Record<string, unknown>;
  if ("status" in updateObj && typeof updateObj.status === "string") {
    return String(updateObj.status);
  }
  if (updateObj.$set && typeof updateObj.$set === "object") {
    const fromSet = (updateObj.$set as Record<string, unknown>).status;
    if (typeof fromSet === "string") return String(fromSet);
  }
  return null;
}

function extractRequestedSettlementStatus(update: unknown): string | null {
  if (!update || typeof update !== "object") return null;
  const updateObj = update as Record<string, unknown>;

  if (typeof updateObj["settlement.status"] === "string") {
    return String(updateObj["settlement.status"]);
  }

  if (updateObj.settlement && typeof updateObj.settlement === "object") {
    const directStatus = (updateObj.settlement as Record<string, unknown>).status;
    if (typeof directStatus === "string") return String(directStatus);
  }

  if (updateObj.$set && typeof updateObj.$set === "object") {
    const setObj = updateObj.$set as Record<string, unknown>;
    if (typeof setObj["settlement.status"] === "string") {
      return String(setObj["settlement.status"]);
    }
    if (setObj.settlement && typeof setObj.settlement === "object") {
      const nestedStatus = (setObj.settlement as Record<string, unknown>).status;
      if (typeof nestedStatus === "string") return String(nestedStatus);
    }
  }

  return null;
}

function isOnlySettlementStatusProtectedChange(protectedPathsTouched: string[]) {
  return (
    protectedPathsTouched.length > 0 &&
    protectedPathsTouched.every((path) => path === "settlement.status")
  );
}

function immutableAfterDeliveryError() {
  const err = new Error("Financial fields are immutable after delivery.") as Error & {
    status?: number;
    code?: string;
  };
  err.status = 409;
  err.code = "IMMUTABLE_AFTER_DELIVERY";
  return err;
}

function countedFinalError() {
  const err = new Error("Delivered orders cannot change status.") as Error & {
    status?: number;
    code?: string;
  };
  err.status = 409;
  err.code = "COUNTED_FINAL";
  return err;
}

function docIsDeliveredOrCounted(doc: {
  status?: string;
  settlement?: { counted?: boolean; status?: string } | null;
} | null) {
  if (!doc) return false;
  return doc.status === "delivered" || Boolean(doc.settlement?.counted);
}

async function guardDeliveredFinancialUpdate(context: {
  getUpdate: () => unknown;
  getQuery: () => unknown;
  model: {
    findOne: (query: Record<string, unknown>) => {
      select: (fields: string) => { lean: () => Promise<{ status?: string; settlement?: { counted?: boolean; status?: string } | null } | null> };
    };
  };
}) {
  const update = context.getUpdate();
  const protectedPathsTouched = getProtectedPathsTouched(update);
  const touchesProtectedFields = updateTouchesProtectedFields(update);
  const requestedStatus = extractRequestedStatus(update);
  const requestedSettlementStatus = extractRequestedSettlementStatus(update);
  if (!touchesProtectedFields && requestedStatus == null) return;

  const query = (context.getQuery() || {}) as Record<string, unknown>;
  const existing = await context.model
    .findOne(query)
    .select("status settlement.counted settlement.status")
    .lean();
  const existingSettlementStatus = String(existing?.settlement?.status || "").trim().toLowerCase();
  const existingIsCollected = existingSettlementStatus === "collected";

  if (existingIsCollected) {
    if (requestedSettlementStatus != null && requestedSettlementStatus !== "collected") {
      throw countedFinalError();
    }
    if (touchesProtectedFields) {
      const onlySettlementStatus = isOnlySettlementStatusProtectedChange(protectedPathsTouched);
      const isCollectedNoopStatusUpdate =
        onlySettlementStatus && requestedSettlementStatus === "collected";
      if (!isCollectedNoopStatusUpdate) {
        throw immutableAfterDeliveryError();
      }
    }
  }

  if (!docIsDeliveredOrCounted(existing)) return;

  if (touchesProtectedFields && !existingIsCollected) {
    const onlySettlementStatus = isOnlySettlementStatusProtectedChange(protectedPathsTouched);
    const allowPendingToCollectedSettlementStatus =
      onlySettlementStatus &&
      existingSettlementStatus === "pending" &&
      requestedSettlementStatus === "collected";

    if (!allowPendingToCollectedSettlementStatus) {
      throw immutableAfterDeliveryError();
    }
  }

  const counted = Boolean(existing?.settlement?.counted);
  if (requestedStatus != null && counted && requestedStatus !== "delivered") {
    throw countedFinalError();
  }
}

function attachRevenueGuards(schema: Schema & { __revenueGuardsAttached?: boolean }) {
  if (schema.__revenueGuardsAttached) return;

  schema.pre("save", async function () {
    const deliveredOrCounted =
      this.get("status") === "delivered" || Boolean(this.get("settlement.counted"));
    const protectedFieldChanged = PROTECTED_FINANCIAL_PATH_PREFIXES.some((path) =>
      this.isModified(path)
    );
    const settlementStatusChanged = this.isModified("settlement.status");
    const requestedSettlementStatus = settlementStatusChanged
      ? String(this.get("settlement.status") || "").trim().toLowerCase()
      : null;
    const needsExistingForSettlementChecks = protectedFieldChanged || settlementStatusChanged;
    let existing:
      | { status?: string; settlement?: { counted?: boolean; status?: string } | null }
      | null
      | undefined;
    if (!this.isNew && needsExistingForSettlementChecks && this.get("_id")) {
      const model = this.constructor as unknown as {
        findById: (
          id: unknown
        ) => {
          select: (fields: string) => {
            lean: () => Promise<{ status?: string; settlement?: { counted?: boolean; status?: string } | null } | null>;
          };
        };
      };
      existing = await model
        .findById(this.get("_id"))
        .select("status settlement.counted settlement.status")
        .lean();
    }
    const existingSettlementStatus = String(existing?.settlement?.status || "").trim().toLowerCase();
    const existingIsCollected = existingSettlementStatus === "collected";

    if (
      !this.isNew &&
      existingIsCollected &&
      settlementStatusChanged &&
      requestedSettlementStatus !== "collected"
    ) {
      throw countedFinalError();
    }

    if (
      !this.isNew &&
      deliveredOrCounted &&
      protectedFieldChanged
    ) {
      const otherProtectedPathChanged = PROTECTED_FINANCIAL_PATH_PREFIXES.some(
        (path) => path !== "settlement.status" && this.isModified(path)
      );
      const allowPendingToCollectedSettlementStatus =
        settlementStatusChanged &&
        !otherProtectedPathChanged &&
        existingSettlementStatus === "pending" &&
        requestedSettlementStatus === "collected";

      if (!allowPendingToCollectedSettlementStatus) {
        throw immutableAfterDeliveryError();
      }
    }

    if (
      !this.isNew &&
      Boolean(this.get("settlement.counted")) &&
      this.isModified("status") &&
      this.get("status") !== "delivered"
    ) {
      throw countedFinalError();
    }
  });

  schema.pre("findOneAndUpdate", async function () {
    await guardDeliveredFinancialUpdate(this);
  });

  schema.pre("updateOne", async function () {
    await guardDeliveredFinancialUpdate(this);
  });

  schema.pre("updateMany", async function () {
    await guardDeliveredFinancialUpdate(this);
  });

  schema.__revenueGuardsAttached = true;
}

attachRevenueGuards(OrderSchema as Schema & { __revenueGuardsAttached?: boolean });

OrderSchema.index({ businessId: 1, createdAt: -1 });
OrderSchema.index({ businessId: 1, status: 1 });
OrderSchema.index({ status: 1, createdAt: -1 });
OrderSchema.index({ cityId: 1, createdAt: -1 });
OrderSchema.index({ cityId: 1, status: 1, createdAt: -1 });
OrderSchema.index({ phone: 1, createdAt: 1 });
OrderSchema.index({ phoneHash: 1, createdAt: -1, status: 1 });
OrderSchema.index({ phoneHash: 1, sessionIdHash: 1, createdAt: -1 });
OrderSchema.index({ createdAt: -1 });
OrderSchema.index({ "settlement.weekKey": 1, businessId: 1 });
OrderSchema.index({ "dispatch.assignedDriverId": 1, createdAt: -1 });
OrderSchema.index({ cityId: 1, "dispatch.assignedDriverId": 1, createdAt: -1 });
OrderSchema.index({ status: 1, "dispatch.assignedDriverId": 1, createdAt: -1 });
OrderSchema.index({ cityId: 1, status: 1, "deliverySnapshot.mode": 1, createdAt: -1 });
OrderSchema.index({ "deliveryProof.verifiedAt": -1, createdAt: -1 });
OrderSchema.index({ "dispatch.routeBatchId": 1, "dispatch.routeSequence": 1 });
OrderSchema.index({ cityId: 1, status: 1, "deliveryException.status": 1, createdAt: -1 });
OrderSchema.index({
  businessId: 1,
  "settlement.weekKey": 1,
  status: 1,
  "settlement.counted": 1,
  createdAt: -1,
});
OrderSchema.index({ "attribution.source": 1, createdAt: -1 });
OrderSchema.index({ "attribution.campaignId": 1, createdAt: -1 });

const existingOrderModel = models.Order;
if (existingOrderModel) {
  const existingSchema = existingOrderModel.schema as Schema & {
    __orderSchemaMerged?: boolean;
    __revenueGuardsAttached?: boolean;
    add?: (obj: Record<string, unknown>) => unknown;
    path?: (name: string) => unknown;
  };
  const existingStatusPath = existingSchema.path?.("status") as
    | {
        enumValues?: string[];
        options?: { enum?: string[]; default?: string };
      }
    | undefined;
  if (existingStatusPath) {
    existingStatusPath.enumValues = [
      "pending_payment",
      "new",
      "accepted",
      "preparing",
      "ready",
      "out_for_delivery",
      "delivered",
      "cancelled",
    ];
    if (existingStatusPath.options) {
      existingStatusPath.options.enum = [...existingStatusPath.enumValues];
      existingStatusPath.options.default = "new";
    }
  }
  const needsDispatchMerge = !existingSchema.path?.("dispatch");
  const needsDeliverySnapshotMerge = !existingSchema.path?.("deliverySnapshot");
  const needsMerchantDeliveryMerge = !existingSchema.path?.("merchantDelivery");
  const needsDeliveryProofMerge =
    !existingSchema.path?.("deliveryProof") ||
    !existingSchema.path?.("deliveryProof.capturedAt");
  const needsDeliveryExceptionMerge =
    !existingSchema.path?.("deliveryException") ||
    !existingSchema.path?.("deliveryException.reportedAt");
  const needsOpsMerge =
    !existingSchema.path?.("cancellation.reason") ||
    !existingSchema.path?.("merchantIssues") ||
    !existingSchema.path?.("adjustments") ||
    !existingSchema.path?.("orderEvents");
  const needsRouteBatchMerge =
    !existingSchema.path?.("dispatch.routeBatchId") ||
    !existingSchema.path?.("dispatch.routeSequence") ||
    !existingSchema.path?.("dispatch.currentStopIndex");
  const needsDriverCheckpointMerge =
    !existingSchema.path?.("dispatch.driverDispatchStatus") ||
    !existingSchema.path?.("dispatch.currentOfferDriverId") ||
    !existingSchema.path?.("dispatch.currentOfferAttemptId") ||
    !existingSchema.path?.("dispatch.currentOfferSentAt") ||
    !existingSchema.path?.("dispatch.offerExpiresAt") ||
    !existingSchema.path?.("dispatch.currentOfferDistanceKm") ||
    !existingSchema.path?.("dispatch.dispatchAttempts") ||
    !existingSchema.path?.("dispatch.driverArrivedAt") ||
    !existingSchema.path?.("dispatch.arrivedAtCustomerAt") ||
    !existingSchema.path?.("dispatch.paymentCollectedAt") ||
    !existingSchema.path?.("dispatch.paymentCollectionMethod") ||
    !existingSchema.path?.("dispatch.paymentCollectionProvider") ||
    !existingSchema.path?.("dispatch.paymentCollectionReference") ||
    !existingSchema.path?.("dispatch.paymentCollectionNote");
  const needsCityMerge = !existingSchema.path?.("cityId");
  const needsNotesMerge = !existingSchema.path?.("notes");
  const needsPaymentMerge =
    !existingSchema.path?.("payment.paidAt") ||
    !existingSchema.path?.("payment.provider") ||
    !existingSchema.path?.("payment.reference") ||
    !existingSchema.path?.("paytechRefCommand") ||
    !existingSchema.path?.("paytechTransactionId") ||
    !existingSchema.path?.("paytechPaymentUrl") ||
    !existingSchema.path?.("paytechRawStatus") ||
    !existingSchema.path?.("paytechWebhookPayload") ||
    !existingSchema.path?.("failedAt");
  const needsPromoCodeMerge =
    !existingSchema.path?.("promoCode") ||
    !existingSchema.path?.("discount.promoCodeId");
  const needsDeliveryFeeSnapshotMerge =
    !existingSchema.path?.("deliveryFeeModelAtOrderTime") ||
    !existingSchema.path?.("deliveryFeeBandAtOrderTime") ||
    !existingSchema.path?.("riderPayoutExpectedAtOrderTime") ||
    !existingSchema.path?.("orderTotal") ||
    !existingSchema.path?.("platformCommissionAmount") ||
    !existingSchema.path?.("restaurantNetAmount") ||
    !existingSchema.path?.("driverPayoutAmount");
  const needsOrderItemCatalogMerge =
    !existingSchema.path?.("items.displaySize") ||
    !existingSchema.path?.("items.quantityValue") ||
    !existingSchema.path?.("items.quantityUnit");
  if (
    !existingSchema.__orderSchemaMerged ||
    needsDispatchMerge ||
    needsDeliverySnapshotMerge ||
      needsMerchantDeliveryMerge ||
      needsDeliveryProofMerge ||
      needsDeliveryExceptionMerge ||
      needsOpsMerge ||
      needsRouteBatchMerge ||
      needsDriverCheckpointMerge ||
      needsCityMerge ||
      needsNotesMerge ||
      needsPaymentMerge ||
      needsPromoCodeMerge ||
      needsDeliveryFeeSnapshotMerge ||
      needsOrderItemCatalogMerge
    ) {
    const schemaObj = (OrderSchema as unknown as { obj: Record<string, unknown> }).obj;
    existingSchema.add?.(schemaObj);
    existingSchema.__orderSchemaMerged = true;
  }
  attachRevenueGuards(existingSchema);
}

export const Order = existingOrderModel || model("Order", OrderSchema);
