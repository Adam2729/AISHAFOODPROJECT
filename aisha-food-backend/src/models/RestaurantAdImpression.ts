import { Schema, model, models } from "mongoose";

const RestaurantAdImpressionSchema = new Schema(
  {
    cityId: { type: Schema.Types.ObjectId, ref: "City", required: true, index: true },
    businessId: { type: Schema.Types.ObjectId, ref: "Business", required: true, index: true },
    campaignId: {
      type: Schema.Types.ObjectId,
      ref: "RestaurantAdCampaign",
      required: true,
      index: true,
    },
    timestamp: { type: Date, required: true, default: Date.now, index: true },
  },
  { timestamps: false }
);

export const RestaurantAdImpression =
  models.RestaurantAdImpression || model("RestaurantAdImpression", RestaurantAdImpressionSchema);
