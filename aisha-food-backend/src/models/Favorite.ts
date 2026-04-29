import { Schema, model, models } from "mongoose";

const FavoriteSchema = new Schema(
  {
    phoneHash: { type: String, required: true, index: true },
    businessId: { type: Schema.Types.ObjectId, ref: "Business", required: true, index: true },
  },
  { timestamps: true }
);

FavoriteSchema.index({ phoneHash: 1, businessId: 1 }, { unique: true });

export const Favorite = models.Favorite || model("Favorite", FavoriteSchema);

