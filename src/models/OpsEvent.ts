import { Schema, model, models } from "mongoose";

const FINANCE_ANOMALY_TYPES = [
  "FIN_MISSING_SETTLEMENT",
  "FIN_MISSING_CASH",
  "FIN_HASH_MISMATCH",
  "FIN_DIFF_OVER_THRESHOLD",
  "FIN_STALE_SUBMISSION",
] as const;

const SECURITY_EVENT_TYPES = [
  "PII_REDACT_RUN",
  "RATE_LIMIT_BLOCKED",
  "ADMIN_PII_REVEAL",
  "ADMIN_PII_REVEAL_DRIVER",
] as const;

const OPS_EVENT_TYPES = [
  "order_blocked",
  "BUSINESS_AUTO_PAUSED",
  "DISPATCH_ASSIGN",
  "CASH_HANDOFF_MARKED",
  "DRIVER_CREATE",
  "DRIVER_UPDATE",
  "DELIVERY_OVERRIDE",
  ...FINANCE_ANOMALY_TYPES,
  ...SECURITY_EVENT_TYPES,
] as const;

const OpsEventSchema = new Schema(
  {
    type: {
      type: String,
      enum: OPS_EVENT_TYPES,
      required: true,
      index: true,
    },
    reason: {
      type: String,
      default: null,
      index: true,
    },
    severity: { type: String, enum: ["low", "medium", "high", null], default: null, index: true },
    weekKey: { type: String, required: true, index: true },
    businessId: { type: Schema.Types.ObjectId, ref: "Business", default: null, index: true },
    businessName: { type: String, default: "", trim: true },
    meta: { type: Object, default: null },
  },
  { timestamps: true, collection: "opsevents" }
);

OpsEventSchema.index({ weekKey: 1, type: 1, reason: 1 });
OpsEventSchema.index({ weekKey: 1, businessId: 1, reason: 1 });
OpsEventSchema.index({ weekKey: 1, type: 1, createdAt: -1 });
OpsEventSchema.index({ businessId: 1, weekKey: 1, type: 1, createdAt: -1 });
OpsEventSchema.index({ type: 1, createdAt: -1 });
OpsEventSchema.index({ "meta.route": 1, createdAt: -1 });
OpsEventSchema.index({ "meta.ipHash": 1, createdAt: -1 });
OpsEventSchema.index(
  { businessId: 1, weekKey: 1, type: 1 },
  {
    unique: true,
    partialFilterExpression: {
      type: { $in: [...FINANCE_ANOMALY_TYPES] },
    },
  }
);

const existingOpsEventModel = models.OpsEvent;
if (existingOpsEventModel) {
  const existingSchema = existingOpsEventModel.schema as Schema & {
    __opsSchemaMerged?: boolean;
    add?: (obj: Record<string, unknown>) => unknown;
    path?: (name: string) => {
      options?: Record<string, unknown>;
      enumValues?: string[];
    } | null;
  };

  if (!existingSchema.__opsSchemaMerged) {
    const schemaObj = (OpsEventSchema as unknown as { obj: Record<string, unknown> }).obj;
    existingSchema.add?.(schemaObj);

    const businessIdPath = existingSchema.path?.("businessId") as
      | { options?: Record<string, unknown> }
      | undefined
      | null;
    if (businessIdPath?.options) {
      businessIdPath.options.required = false;
      businessIdPath.options.default = null;
    }

    const reasonPath = existingSchema.path?.("reason") as
      | { options?: Record<string, unknown> }
      | undefined
      | null;
    if (reasonPath?.options) {
      delete reasonPath.options.enum;
    }

    existingSchema.__opsSchemaMerged = true;
  }

  const typePath = existingSchema.path?.("type") as
    | {
        options?: Record<string, unknown>;
        enumValues?: string[];
      }
    | undefined
    | null;
  if (typePath) {
    const currentEnum = Array.isArray(typePath.enumValues) ? typePath.enumValues : [];
    const mergedEnum = Array.from(new Set([...currentEnum, ...OPS_EVENT_TYPES]));
    typePath.enumValues = mergedEnum;
    if (typePath.options) {
      typePath.options.enum = mergedEnum;
    }
  }
}

export const OpsEvent = existingOpsEventModel || model("OpsEvent", OpsEventSchema);
