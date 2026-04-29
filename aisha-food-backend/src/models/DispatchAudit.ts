import { Schema, model, models } from "mongoose";

const DISPATCH_ACTIONS = [
  "ASSIGN_DRIVER",
  "DRIVER_ASSIGNED",
  "DRIVER_REASSIGNED",
  "AUTO_DRIVER_ASSIGNED",
  "AUTO_DRIVER_REASSIGNED",
  "AUTO_DRIVER_OFFERED",
  "AUTO_DRIVER_OFFER_REJECTED",
  "AUTO_DRIVER_OFFER_EXPIRED",
  "AUTO_DRIVER_NO_MATCH",
  "AUTO_ASSIGN_SKIPPED",
  "UNASSIGN_DRIVER",
  "PICKUP_CONFIRMED",
  "PICKED_UP",
  "DRIVER_ARRIVED_RESTAURANT",
  "DRIVER_ARRIVED_CUSTOMER",
  "PAYMENT_COLLECTED",
  "ORDER_REJECTED",
  "DELIVERED_CONFIRMED",
  "DELIVERED_WITH_DRIVER_OTP",
  "DELIVERY_EXCEPTION_REPORTED",
  "CASH_HANDOFF_NOTE",
] as const;

const DispatchAuditSchema = new Schema(
  {
    cityId: { type: Schema.Types.ObjectId, ref: "City", default: null, index: true },
    orderId: { type: Schema.Types.ObjectId, ref: "Order", required: true, index: true },
    businessId: { type: Schema.Types.ObjectId, ref: "Business", required: true, index: true },
    driverId: { type: Schema.Types.ObjectId, ref: "Driver", default: null, index: true },
    action: {
      type: String,
      enum: [...DISPATCH_ACTIONS],
      required: true,
      index: true,
    },
    actor: {
      type: String,
      enum: ["admin", "merchant", "driver", "ops"],
      required: true,
      index: true,
    },
    meta: {
      driverId: { type: Schema.Types.ObjectId, ref: "Driver", default: null },
      driverName: { type: String, default: null, trim: true },
      note: { type: String, default: null, trim: true, maxlength: 200 },
      previousDriverId: { type: Schema.Types.ObjectId, ref: "Driver", default: null },
      newDriverId: { type: Schema.Types.ObjectId, ref: "Driver", default: null },
      selectedDriverId: { type: Schema.Types.ObjectId, ref: "Driver", default: null },
      cityId: { type: Schema.Types.ObjectId, ref: "City", default: null },
      reason: { type: String, default: null, trim: true, maxlength: 120 },
      etaMinutes: { type: Number, default: null, min: 0 },
      score: { type: Number, default: null },
      rankedTop5: { type: [Schema.Types.Mixed], default: undefined },
    },
  },
  {
    collection: "dispatchaudits",
    timestamps: { createdAt: true, updatedAt: false },
  }
);

DispatchAuditSchema.index({ cityId: 1, createdAt: -1 });
DispatchAuditSchema.index({ cityId: 1, driverId: 1, createdAt: -1 });
DispatchAuditSchema.index({ cityId: 1, orderId: 1, createdAt: -1 });
DispatchAuditSchema.index({ orderId: 1, createdAt: -1 });
DispatchAuditSchema.index({ businessId: 1, createdAt: -1 });
DispatchAuditSchema.index({ action: 1, createdAt: -1 });
DispatchAuditSchema.index({ driverId: 1, createdAt: -1 });

const existingDispatchAuditModel = models.DispatchAudit;
if (existingDispatchAuditModel) {
  const existingSchema = existingDispatchAuditModel.schema as Schema & {
    __dispatchAuditSchemaMerged?: boolean;
    add?: (obj: Record<string, unknown>) => unknown;
    path?: (name: string) => unknown;
  };
  const needsMerge =
    !existingSchema.path?.("cityId") ||
    !existingSchema.path?.("driverId") ||
    !existingSchema.path?.("meta.previousDriverId") ||
    !existingSchema.path?.("meta.newDriverId") ||
    !existingSchema.path?.("meta.cityId") ||
    !existingSchema.path?.("meta.selectedDriverId") ||
    !existingSchema.path?.("meta.reason") ||
    !existingSchema.path?.("meta.etaMinutes") ||
    !existingSchema.path?.("meta.score") ||
    !existingSchema.path?.("meta.rankedTop5");
  if (!existingSchema.__dispatchAuditSchemaMerged || needsMerge) {
    const schemaObj = (DispatchAuditSchema as unknown as { obj: Record<string, unknown> }).obj;
    existingSchema.add?.(schemaObj);
    existingSchema.__dispatchAuditSchemaMerged = true;
  }
  const actionPath = existingSchema.path?.("action") as
    | (Schema.Types.String & { enumValues?: string[]; options?: { enum?: string[] } })
    | undefined;
  if (actionPath) {
    actionPath.enumValues = [...DISPATCH_ACTIONS];
    if (actionPath.options) {
      actionPath.options.enum = [...DISPATCH_ACTIONS];
    }
  }
}

export const DispatchAudit = existingDispatchAuditModel || model("DispatchAudit", DispatchAuditSchema);
