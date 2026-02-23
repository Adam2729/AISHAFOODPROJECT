import { Schema, model, models } from "mongoose";

const SystemSettingSchema = new Schema(
  {
    key: { type: String, required: true, unique: true, index: true, trim: true },
    value: { type: Schema.Types.Mixed, default: null },
  },
  { timestamps: true }
);

export const SystemSetting = models.SystemSetting || model("SystemSetting", SystemSettingSchema);
