import { Schema, model, models } from "mongoose";

const IdempotencyKeySchema = new Schema(
  {
    keyHash: { type: String, required: true, unique: true, index: true },
    route: { type: String, enum: ["public.orders.create"], required: true, index: true },
    phoneHash: { type: String, default: null, index: true },
    response: {
      statusCode: { type: Number, default: null },
      bodyJson: { type: Schema.Types.Mixed, default: null },
    },
  },
  { timestamps: true, collection: "idempotencykeys" }
);

IdempotencyKeySchema.index({ createdAt: 1 }, { expireAfterSeconds: 48 * 60 * 60 });

export const IdempotencyKey =
  models.IdempotencyKey || model("IdempotencyKey", IdempotencyKeySchema);
