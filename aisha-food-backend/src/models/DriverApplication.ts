import mongoose from "mongoose";

const DriverApplicationSchema = new mongoose.Schema(
  {
    cityId: { type: mongoose.Schema.Types.ObjectId, ref: "City", required: true, index: true },
    status: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
      index: true,
    },
    name: { type: String, required: true, trim: true, maxlength: 80 },
    phone: { type: String, required: true, trim: true, maxlength: 30 },
    phoneHash: { type: String, required: true, index: true },
    email: { type: String, required: true, trim: true, lowercase: true, maxlength: 160 },
    zoneLabel: { type: String, default: null, trim: true, maxlength: 80 },
    vehicleType: { type: String, default: null, trim: true, maxlength: 40 },
    availability: { type: String, default: null, trim: true, maxlength: 80 },
    documentsStatus: { type: String, default: null, trim: true, maxlength: 40 },
    idDocumentUrl: { type: String, default: null, trim: true, maxlength: 500 },
    referredByCode: { type: String, default: null, trim: true, uppercase: true, maxlength: 24 },
    notes: { type: String, default: null, trim: true, maxlength: 280 },
    confirmationEmailStatus: {
      type: String,
      enum: ["pending", "logged", "sent", "failed", "skipped"],
      default: "pending",
    },
    confirmationEmailProvider: { type: String, default: null, trim: true, maxlength: 40 },
    confirmationEmailSentAt: { type: Date, default: null },
    confirmationEmailError: { type: String, default: null, trim: true, maxlength: 280 },
    createdByIpHash: { type: String, default: null },
    reviewedAt: { type: Date, default: null },
    reviewedByAdminId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    rejectReason: { type: String, default: null, trim: true, maxlength: 280 },
    driverId: { type: mongoose.Schema.Types.ObjectId, ref: "Driver", default: null },
    referrerDriverId: { type: mongoose.Schema.Types.ObjectId, ref: "Driver", default: null },
    referralRewardAmount: { type: Number, default: 0, min: 0 },
    referralBonusAppliedAt: { type: Date, default: null },
  },
  { timestamps: true, collection: "driverapplications" }
);

DriverApplicationSchema.index({ cityId: 1, status: 1, createdAt: -1 });
DriverApplicationSchema.index({ phoneHash: 1, cityId: 1 });

const existingDriverApplicationModel = mongoose.models.DriverApplication;
if (existingDriverApplicationModel) {
  const existingSchema = existingDriverApplicationModel.schema as mongoose.Schema & {
    __driverApplicationSchemaMerged?: boolean;
    add?: (obj: Record<string, unknown>) => unknown;
    path?: (name: string) => unknown;
  };
  const needsReferralMerge =
    !existingSchema.path?.("email") ||
    !existingSchema.path?.("vehicleType") ||
    !existingSchema.path?.("availability") ||
    !existingSchema.path?.("documentsStatus") ||
    !existingSchema.path?.("idDocumentUrl") ||
    !existingSchema.path?.("referredByCode") ||
    !existingSchema.path?.("confirmationEmailStatus") ||
    !existingSchema.path?.("confirmationEmailProvider") ||
    !existingSchema.path?.("confirmationEmailSentAt") ||
    !existingSchema.path?.("confirmationEmailError") ||
    !existingSchema.path?.("referrerDriverId") ||
    !existingSchema.path?.("referralRewardAmount") ||
    !existingSchema.path?.("referralBonusAppliedAt");
  if (!existingSchema.__driverApplicationSchemaMerged || needsReferralMerge) {
    const schemaObj = (DriverApplicationSchema as unknown as { obj: Record<string, unknown> }).obj;
    existingSchema.add?.(schemaObj);
    existingSchema.__driverApplicationSchemaMerged = true;
  }
}

export const DriverApplication =
  existingDriverApplicationModel || mongoose.model("DriverApplication", DriverApplicationSchema);
