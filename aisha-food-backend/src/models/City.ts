import { Schema, model, models } from "mongoose";

const CitySchema = new Schema(
  {
    code: { type: String, required: true, trim: true, uppercase: true, maxlength: 12 },
    slug: { type: String, required: true, trim: true, lowercase: true, maxlength: 80 },
    name: { type: String, required: true, trim: true, maxlength: 80 },
    country: { type: String, required: true, trim: true, maxlength: 80 },
    currency: { type: String, enum: ["DOP", "CFA"], required: true, default: "DOP" },
    maxDeliveryRadiusKm: { type: Number, required: true, default: 8, min: 1, max: 200 },
    coverageCenterLat: { type: Number, required: true, default: 0 },
    coverageCenterLng: { type: Number, required: true, default: 0 },
    commissionRate: { type: Number, required: true, default: 0.08, min: 0, max: 1 },
    subscriptionEnabled: { type: Boolean, default: true },
    subscriptionPrice: { type: Number, default: 0, min: 0 },
    deliveryFeeModel: {
      type: String,
      enum: ["restaurantPays", "customerPays"],
      default: "restaurantPays",
    },
    deliveryFeeBands: {
      type: [
        new Schema(
          {
            minKm: { type: Number, required: true, min: 0 },
            maxKm: { type: Number, required: true, min: 0 },
            fee: { type: Number, required: true, min: 0 },
          },
          { _id: false }
        ),
      ],
      default: [],
    },
    deliveryFeeCurrency: { type: String, enum: ["DOP", "CFA"], default: "DOP" },
    riderPayoutModel: {
      type: String,
      enum: ["none", "perDelivery"],
      default: "none",
    },
    riderPayoutFlat: { type: Number, default: 0, min: 0 },
    platformDeliveryMargin: { type: Number, default: 0, min: 0 },
    paymentMethods: {
      type: [String],
      enum: ["cash", "orangeMoney", "moovMoney"],
      default: ["cash"],
    },
    riderModel: {
      type: String,
      enum: ["selfDelivery", "freelance", "hybrid"],
      default: "selfDelivery",
    },
    supportWhatsAppE164: { type: String, default: "", trim: true, maxlength: 24 },
    isActive: { type: Boolean, default: true, index: true },
  },
  { timestamps: true }
);

CitySchema.index({ name: 1, country: 1 }, { unique: true });
CitySchema.index({ code: 1 }, { unique: true });
CitySchema.index({ slug: 1 }, { unique: true });
CitySchema.index({ isActive: 1, name: 1 });

const existingCityModel = models.City;
if (existingCityModel) {
  const existingSchema = existingCityModel.schema as Schema & {
    __citySchemaMerged?: boolean;
    add?: (obj: Record<string, unknown>) => unknown;
    path?: (name: string) => unknown;
  };
  const needsMerge =
    !existingSchema.path?.("code") ||
    !existingSchema.path?.("slug") ||
    !existingSchema.path?.("coverageCenterLat") ||
    !existingSchema.path?.("deliveryFeeBands") ||
    !existingSchema.path?.("riderPayoutModel");
  if (!existingSchema.__citySchemaMerged || needsMerge) {
    const schemaObj = (CitySchema as unknown as { obj: Record<string, unknown> }).obj;
    existingSchema.add?.(schemaObj);
    existingSchema.__citySchemaMerged = true;
  }
}

export const City = existingCityModel || model("City", CitySchema);
