import { Schema, model, models } from "mongoose";

const RestaurantAdClickSchema = new Schema(
  {
    cityId: { type: Schema.Types.ObjectId, ref: "City", required: true, index: true },
    businessId: { type: Schema.Types.ObjectId, ref: "Business", required: true, index: true },
    campaignId: {
      type: Schema.Types.ObjectId,
      ref: "RestaurantAdCampaign",
      required: true,
      index: true,
    },
    cost: { type: Number, required: true, min: 0, default: 0 },
    timestamp: { type: Date, required: true, default: Date.now, index: true },
  },
  { timestamps: false }
);
RestaurantAdClickSchema.index({ cityId: 1, timestamp: -1 });

export const RestaurantAdClick =
  models.RestaurantAdClick || model("RestaurantAdClick", RestaurantAdClickSchema);
