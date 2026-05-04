import { Schema, model, models } from "mongoose";

const ReviewSchema = new Schema(
  {
    businessId: {
      type: Schema.Types.ObjectId,
      ref: "Business",
      required: true,
      index: true,
    },
    orderId: {
      type: Schema.Types.ObjectId,
      ref: "Order",
      required: true,
      index: true,
      unique: true,
    },
    rating: {
      type: Number,
      required: true,
      min: 1,
      max: 5,
      index: true,
    },
    tags: {
      type: [String],
      default: [],
      validate: {
        validator: (value: unknown) => Array.isArray(value) && value.length <= 8,
        message: "tags supports up to 8 items.",
      },
    },
    comment: {
      type: String,
      default: "",
      trim: true,
      maxlength: 280,
    },
    source: {
      type: String,
      enum: ["track", "history", "support", "unknown"],
      default: "unknown",
      index: true,
    },
    isHidden: {
      type: Boolean,
      default: false,
      index: true,
    },
    moderationNote: {
      type: String,
      default: "",
      trim: true,
      maxlength: 200,
    },
  },
  { timestamps: true, collection: "reviews" }
);

ReviewSchema.pre("save", function () {
  if (Array.isArray(this.tags)) {
    this.tags = this.tags
      .map((tag) => String(tag || "").trim().toLowerCase().slice(0, 24))
      .filter(Boolean)
      .slice(0, 8);
  }
  this.comment = String(this.comment || "").trim().slice(0, 280);
  this.moderationNote = String(this.moderationNote || "").trim().slice(0, 200);
});

ReviewSchema.index({ orderId: 1 }, { unique: true });
ReviewSchema.index({ businessId: 1, createdAt: -1 });
ReviewSchema.index({ businessId: 1, rating: 1, createdAt: -1 });
ReviewSchema.index({ createdAt: -1 });

export const Review = models.Review || model("Review", ReviewSchema);

