import { Schema, model, models } from "mongoose";

const FunnelEventSchema = new Schema(
  {
    event: {
      type: String,
      enum: ["business_view", "add_to_cart", "checkout_start", "order_success", "order_fail"],
      required: true,
      index: true,
    },
    businessId: {
      type: Schema.Types.ObjectId,
      ref: "Business",
      required: true,
      index: true,
    },
    businessType: {
      type: String,
      enum: ["restaurant", "colmado", "unknown"],
      default: "unknown",
      index: true,
    },
    source: {
      type: String,
      enum: ["home", "search", "favorites", "buy_again", "reorder", "unknown"],
      default: "unknown",
      index: true,
    },
    meta: {
      cartItemsCount: { type: Number, default: null },
      cartSubtotal: { type: Number, default: null },
      failCode: { type: String, default: null },
    },
    sessionIdHash: { type: String, default: null, index: true },
  },
  { timestamps: true, collection: "funnelevents" }
);

FunnelEventSchema.index({ createdAt: -1 });
FunnelEventSchema.index({ createdAt: -1, event: 1 });
FunnelEventSchema.index({ createdAt: -1, businessId: 1, event: 1 });
FunnelEventSchema.index({ createdAt: -1, source: 1, event: 1 });

export const FunnelEvent = models.FunnelEvent || model("FunnelEvent", FunnelEventSchema);

