import { Schema, model, models } from "mongoose";

const RestaurantAdCampaignSchema = new Schema(
  {
    cityId: { type: Schema.Types.ObjectId, ref: "City", required: true, index: true },
    businessId: { type: Schema.Types.ObjectId, ref: "Business", required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    dailyBudget: { type: Number, required: true, min: 0 },
    totalBudget: { type: Number, required: true, min: 0 },
    spent: { type: Number, default: 0, min: 0 },
    startDate: { type: Date, required: true, index: true },
    endDate: { type: Date, required: true, index: true },
    priority: { type: Number, default: 1, min: 0 },
    isActive: { type: Boolean, default: true, index: true },
  },
  { timestamps: true }
);

RestaurantAdCampaignSchema.index({ cityId: 1, isActive: 1 });

export const RestaurantAdCampaign =
  models.RestaurantAdCampaign || model("RestaurantAdCampaign", RestaurantAdCampaignSchema);
