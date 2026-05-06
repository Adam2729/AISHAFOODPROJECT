import { Schema, model, models } from "mongoose";
import { PAYOUT_METHODS } from "@/lib/merchantOnboarding";
import { normalizePhone, phoneToHash } from "@/lib/phoneHash";

const DriverSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    email: { type: String, default: null, trim: true, lowercase: true, maxlength: 120, index: true },
    phoneE164: { type: String, default: null, trim: true },
    phoneHash: { type: String, required: true, default: "", index: true },
    auth: {
      passwordHash: { type: String, default: null },
      passwordSetAt: { type: Date, default: null },
      lastLoginAt: { type: Date, default: null },
    },
    cityId: { type: Schema.Types.ObjectId, ref: "City", required: true, index: true },
    isActive: { type: Boolean, default: true, index: true },
    isBanned: { type: Boolean, default: false, index: true },
    availability: {
      type: String,
      enum: ["offline", "available", "busy", "paused"],
      default: "offline",
      index: true,
    },
    bannedAt: { type: Date, default: null },
    bannedReason: { type: String, default: null, trim: true, maxlength: 280 },
    pausedAt: { type: Date, default: null },
    pausedReason: { type: String, default: null, trim: true, maxlength: 280 },
    breakStartedAt: { type: Date, default: null },
    breakReason: {
      type: String,
      enum: ["break", "fuel", "vehicle_issue", "prayer", "other", null],
      default: null,
      trim: true,
    },
    breakNote: { type: String, default: "", trim: true, maxlength: 200 },
    lastSeenAt: { type: Date, default: null },
    lastAssignedAt: { type: Date, default: null },
    lastDeliveryConfirmedAt: { type: Date, default: null },
    pushToken: { type: String, default: null, trim: true, maxlength: 200 },
    pushTokenUpdatedAt: { type: Date, default: null },
    zoneLabel: { type: String, default: null, trim: true, maxlength: 80, index: true },
    vehicleType: { type: String, default: null, trim: true, maxlength: 40 },
    payout: {
      preferredMethod: {
        type: String,
        enum: PAYOUT_METHODS,
        default: "cash",
      },
      accountName: { type: String, default: "", trim: true, maxlength: 120 },
      accountNumber: { type: String, default: "", trim: true, maxlength: 120 },
      notes: { type: String, default: "", trim: true, maxlength: 400 },
    },
    referralCode: {
      type: String,
      default: null,
      trim: true,
      uppercase: true,
      maxlength: 24,
    },
    referredByCode: {
      type: String,
      default: null,
      trim: true,
      uppercase: true,
      maxlength: 24,
    },
    signupBonusAmount: { type: Number, default: 0, min: 0 },
    referralBonusAudit: {
      type: [
        new Schema(
          {
            appliedAt: { type: Date, default: Date.now },
            applicationId: { type: Schema.Types.ObjectId, ref: "DriverApplication", default: null },
            referredEntityId: { type: Schema.Types.ObjectId, ref: "Driver", default: null },
            referredByCode: { type: String, default: null, trim: true, uppercase: true, maxlength: 24 },
            rewardAmount: { type: Number, default: 0, min: 0 },
            kind: {
              type: String,
              enum: ["referrer_credit", "referred_signup"],
              default: "referrer_credit",
            },
            actor: { type: String, default: "system", trim: true, maxlength: 40 },
          },
          { _id: false }
        ),
      ],
      default: [],
    },
    activeOrdersCountCache: { type: Number, default: 0, min: 0 },
    notes: { type: String, default: "", trim: true, maxlength: 280 },
    lastLocation: {
      lat: { type: Number, default: null },
      lng: { type: Number, default: null },
      accuracy: { type: Number, default: null },
      heading: { type: Number, default: null },
      speed: { type: Number, default: null },
      updatedAt: { type: Date, default: null },
    },
  },
  { timestamps: true, collection: "drivers" }
);

DriverSchema.pre("validate", function () {
  const normalized = normalizePhone(String(this.get("phoneE164") || "").trim());
  this.set("phoneE164", normalized || null);
  this.set("phoneHash", normalized ? phoneToHash(normalized) : "");
});

function normalizePhoneUpdate(context: {
  getUpdate: () => unknown;
  setUpdate: (next: Record<string, unknown>) => void;
}) {
  const update = (context.getUpdate() || {}) as Record<string, unknown>;
  const rawPhone =
    typeof update.phoneE164 === "string"
      ? update.phoneE164
      : update.$set && typeof (update.$set as Record<string, unknown>).phoneE164 === "string"
      ? String((update.$set as Record<string, unknown>).phoneE164)
      : null;
  if (rawPhone == null) return;
  const normalized = normalizePhone(rawPhone);

  if (update.$set && typeof update.$set === "object") {
    (update.$set as Record<string, unknown>).phoneE164 = normalized || null;
    (update.$set as Record<string, unknown>).phoneHash = normalized ? phoneToHash(normalized) : "";
  } else {
    update.phoneE164 = normalized || null;
    update.phoneHash = normalized ? phoneToHash(normalized) : "";
  }
  context.setUpdate(update);
}

DriverSchema.pre("findOneAndUpdate", function () {
  normalizePhoneUpdate(this as unknown as {
    getUpdate: () => unknown;
    setUpdate: (next: Record<string, unknown>) => void;
  });
});

DriverSchema.pre("updateOne", function () {
  normalizePhoneUpdate(this as unknown as {
    getUpdate: () => unknown;
    setUpdate: (next: Record<string, unknown>) => void;
  });
});

DriverSchema.pre("updateMany", function () {
  normalizePhoneUpdate(this as unknown as {
    getUpdate: () => unknown;
    setUpdate: (next: Record<string, unknown>) => void;
  });
});

DriverSchema.index({ isActive: 1, name: 1, createdAt: -1 });
DriverSchema.index({ zoneLabel: 1, isActive: 1, createdAt: -1 });
DriverSchema.index({ cityId: 1, isActive: 1, isBanned: 1 });
DriverSchema.index({ cityId: 1, createdAt: -1 });
DriverSchema.index({ cityId: 1, availability: 1, isActive: 1, isBanned: 1 });
DriverSchema.index({ cityId: 1, zoneLabel: 1, availability: 1 });
DriverSchema.index({ referralCode: 1 }, { unique: true, sparse: true });

const existingDriverModel = models.Driver;
if (existingDriverModel) {
  const existingSchema = existingDriverModel.schema as Schema & {
    __driverSchemaMerged?: boolean;
    add?: (obj: Record<string, unknown>) => unknown;
    path?: (name: string) => unknown;
  };
  const needsMerge =
    !existingSchema.path?.("cityId") ||
    !existingSchema.path?.("isBanned") ||
    !existingSchema.path?.("lastDeliveryConfirmedAt") ||
    !existingSchema.path?.("availability") ||
    !existingSchema.path?.("lastAssignedAt") ||
    !existingSchema.path?.("activeOrdersCountCache") ||
    !existingSchema.path?.("vehicleType") ||
    !existingSchema.path?.("email") ||
    !existingSchema.path?.("auth.passwordHash") ||
    !existingSchema.path?.("lastLocation.lat") ||
    !existingSchema.path?.("payout.preferredMethod") ||
    !existingSchema.path?.("payout.accountName") ||
    !existingSchema.path?.("payout.accountNumber") ||
    !existingSchema.path?.("payout.notes") ||
    !existingSchema.path?.("referralCode") ||
    !existingSchema.path?.("referredByCode") ||
    !existingSchema.path?.("signupBonusAmount") ||
    !existingSchema.path?.("referralBonusAudit") ||
    !existingSchema.path?.("breakStartedAt") ||
    !existingSchema.path?.("breakReason") ||
    !existingSchema.path?.("breakNote") ||
    !existingSchema.path?.("pushToken") ||
    !existingSchema.path?.("pushTokenUpdatedAt");
  if (!existingSchema.__driverSchemaMerged || needsMerge) {
    const schemaObj = (DriverSchema as unknown as { obj: Record<string, unknown> }).obj;
    existingSchema.add?.(schemaObj);
    existingSchema.__driverSchemaMerged = true;
  }
  const availabilityPath = existingSchema.path?.("availability") as
    | (Schema.Types.String & { enumValues?: string[]; options?: { enum?: string[] } })
    | undefined;
  if (availabilityPath) {
    availabilityPath.enumValues = ["offline", "available", "busy", "paused"];
    if (availabilityPath.options) {
      availabilityPath.options.enum = ["offline", "available", "busy", "paused"];
    }
  }
}

export const Driver = existingDriverModel || model("Driver", DriverSchema);
