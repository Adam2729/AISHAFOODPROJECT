import { Schema, model, models } from "mongoose";

const DriverCashHandoffSchema = new Schema(
  {
    orderId: { type: Schema.Types.ObjectId, ref: "Order", required: true, unique: true, index: true },
    businessId: { type: Schema.Types.ObjectId, ref: "Business", required: true, index: true },
    driverId: { type: Schema.Types.ObjectId, ref: "Driver", required: true, index: true },
    weekKey: { type: String, required: true, index: true },
    amountCollectedRdp: { type: Number, required: true, min: 0 },
    collectedAt: { type: Date, required: true },
    handedToMerchantAt: { type: Date, default: null },
    handedToMerchantBy: { type: String, trim: true, maxlength: 60, default: null },
    receiptRef: { type: String, trim: true, maxlength: 120, default: null },
    proofUrl: { type: String, trim: true, maxlength: 500, default: null },
    status: {
      type: String,
      enum: ["collected", "handed_to_merchant", "disputed", "void"],
      default: "collected",
      index: true,
    },
    dispute: {
      openedAt: { type: Date, default: null },
      openedBy: { type: String, enum: ["merchant", "admin", null], default: null },
      reason: { type: String, trim: true, maxlength: 280, default: null },
      resolvedAt: { type: Date, default: null },
      resolution: {
        type: String,
        enum: ["merchant_confirmed", "driver_confirmed", "writeoff", null],
        default: null,
      },
    },
    integrity: {
      expectedHash: { type: String, required: true, index: true },
      computedAt: { type: Date, required: true },
    },
  },
  {
    collection: "drivercashhandoffs",
    timestamps: true,
  }
);

DriverCashHandoffSchema.index({ businessId: 1, weekKey: 1, status: 1 });
DriverCashHandoffSchema.index({ driverId: 1, weekKey: 1, status: 1 });
DriverCashHandoffSchema.index({ orderId: 1 }, { unique: true });

const existingDriverCashHandoffModel = models.DriverCashHandoff;
if (existingDriverCashHandoffModel) {
  const existingSchema = existingDriverCashHandoffModel.schema as Schema & {
    __driverCashHandoffSchemaMerged?: boolean;
    add?: (obj: Record<string, unknown>) => unknown;
    path?: (name: string) => unknown;
  };
  const needsMerge = !existingSchema.path?.("integrity.expectedHash");
  if (!existingSchema.__driverCashHandoffSchemaMerged || needsMerge) {
    const schemaObj = (DriverCashHandoffSchema as unknown as { obj: Record<string, unknown> }).obj;
    existingSchema.add?.(schemaObj);
    existingSchema.__driverCashHandoffSchemaMerged = true;
  }
}

export const DriverCashHandoff =
  existingDriverCashHandoffModel || model("DriverCashHandoff", DriverCashHandoffSchema);
