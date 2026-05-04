import { Schema, model, models } from "mongoose";
import { normalizePhone, phoneToHash } from "@/lib/phoneHash";

const DriverSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    phoneE164: { type: String, default: null, trim: true },
    phoneHash: { type: String, default: "", index: true },
    isActive: { type: Boolean, default: true, index: true },
    zoneLabel: { type: String, default: "", trim: true, maxlength: 80 },
    notes: { type: String, default: "", trim: true, maxlength: 280 },
  },
  { timestamps: true, collection: "drivers" }
);

DriverSchema.pre("save", function () {
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

const existingDriverModel = models.Driver;
if (existingDriverModel) {
  const existingSchema = existingDriverModel.schema as Schema & {
    __driverSchemaMerged?: boolean;
    add?: (obj: Record<string, unknown>) => unknown;
  };
  if (!existingSchema.__driverSchemaMerged) {
    const schemaObj = (DriverSchema as unknown as { obj: Record<string, unknown> }).obj;
    existingSchema.add?.(schemaObj);
    existingSchema.__driverSchemaMerged = true;
  }
}

export const Driver = existingDriverModel || model("Driver", DriverSchema);
