import { Schema, model, models } from "mongoose";

const AppSettingSchema = new Schema(
  {
    key: { type: String, required: true, unique: true, trim: true },
    boolValue: { type: Boolean, default: null },
    numberValue: { type: Number, default: null },
    stringValue: { type: String, default: null },
  },
  {
    timestamps: true,
    collection: "appsettings",
  }
);

export const AppSetting = models.AppSetting || model("AppSetting", AppSettingSchema);
