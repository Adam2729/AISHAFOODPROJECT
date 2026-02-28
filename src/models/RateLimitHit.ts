import { Schema, model, models } from "mongoose";

const RateLimitHitSchema = new Schema(
  {
    scope: {
      type: String,
      enum: [
        "public.orders.phone",
        "public.complaints.phone",
        "public.reviews.phone",
        "public.funnel.session",
      ],
      required: true,
      index: true,
    },
    keyHash: { type: String, required: true, index: true },
    windowKey: { type: String, required: true, index: true },
    count: { type: Number, required: true, default: 0 },
  },
  { timestamps: true, collection: "ratelimithits" }
);

RateLimitHitSchema.index({ scope: 1, keyHash: 1, windowKey: 1 }, { unique: true });
RateLimitHitSchema.index({ createdAt: 1 }, { expireAfterSeconds: 2 * 24 * 60 * 60 });

export const RateLimitHit = models.RateLimitHit || model("RateLimitHit", RateLimitHitSchema);
