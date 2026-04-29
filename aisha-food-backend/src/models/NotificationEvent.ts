import { Schema, model, models } from "mongoose";

const NotificationEventSchema = new Schema(
  {
    dedupeKey: { type: String, required: true, trim: true, maxlength: 220, unique: true, index: true },
    audience: {
      type: String,
      enum: ["merchant", "customer"],
      required: true,
      index: true,
    },
    eventType: { type: String, required: true, trim: true, maxlength: 80, index: true },
    status: {
      type: String,
      enum: ["pending", "processed", "cancelled"],
      default: "pending",
      index: true,
    },
    cityId: { type: Schema.Types.ObjectId, ref: "City", default: null, index: true },
    businessId: { type: Schema.Types.ObjectId, ref: "Business", default: null, index: true },
    orderId: { type: Schema.Types.ObjectId, ref: "Order", default: null, index: true },
    driverId: { type: Schema.Types.ObjectId, ref: "Driver", default: null, index: true },
    customerPhoneHash: { type: String, default: null, trim: true, maxlength: 120, index: true },
    deliveryMode: {
      type: String,
      enum: ["self_delivery", "platform_driver", null],
      default: null,
      index: true,
    },
    title: { type: String, required: true, trim: true, maxlength: 160 },
    body: { type: String, required: true, trim: true, maxlength: 500 },
    suggestedChannels: {
      type: [String],
      default: [],
      validate: {
        validator(value: unknown) {
          return Array.isArray(value) && value.every((item) => ["in_app", "push", "whatsapp", "email"].includes(String(item || "")));
        },
        message: "suggestedChannels contains an unsupported channel.",
      },
    },
    source: { type: String, default: null, trim: true, maxlength: 120 },
    meta: { type: Schema.Types.Mixed, default: null },
    processedAt: { type: Date, default: null },
    cancelledAt: { type: Date, default: null },
  },
  {
    collection: "notificationevents",
    timestamps: true,
  }
);

NotificationEventSchema.index({ audience: 1, status: 1, createdAt: -1 });
NotificationEventSchema.index({ businessId: 1, audience: 1, createdAt: -1 });
NotificationEventSchema.index({ orderId: 1, audience: 1, createdAt: -1 });
NotificationEventSchema.index({ cityId: 1, createdAt: -1 });

export const NotificationEvent =
  models.NotificationEvent || model("NotificationEvent", NotificationEventSchema);
