import { Schema, model, models } from "mongoose";

const UserSchema = new Schema(
  {
    cityId: { type: Schema.Types.ObjectId, ref: "City", default: null, index: true },
    phoneHash: { type: String, required: true, unique: true, index: true, trim: true },
    displayName: { type: String, trim: true, maxlength: 80, default: "" },
    city: { type: String, trim: true, maxlength: 80, default: "" },
    preferredLanguage: { type: String, enum: ["es", "en"], default: "es" },
    marketingOptIn: { type: Boolean, default: false },
    favoriteCuisines: { type: [String], default: [] },
    lastSeenAt: { type: Date, default: null },
  },
  { timestamps: true }
);

UserSchema.index({ phoneHash: 1 }, { unique: true });
UserSchema.index({ cityId: 1, updatedAt: -1 });

export const User = models.User || model("User", UserSchema);
