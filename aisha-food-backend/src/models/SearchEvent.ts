import { Schema, model, models } from "mongoose";

const SearchEventSchema = new Schema(
  {
    queryHash: { type: String, required: true, trim: true, index: true },
    qLen: { type: Number, required: true, min: 0 },
    source: {
      type: String,
      enum: ["home", "searchbar", "buyagain", "favorites", "reorder", "unknown"],
      default: "unknown",
      index: true,
    },
    resultsBusinesses: { type: Number, default: 0, min: 0 },
    resultsProducts: { type: Number, default: 0, min: 0 },
    zeroResults: { type: Boolean, default: false, index: true },
    env: { type: String, default: "" },
    topBusinessIds: {
      type: [{ type: Schema.Types.ObjectId, ref: "Business" }],
      default: [],
    },
  },
  { timestamps: true, collection: "searchevents" }
);

SearchEventSchema.index({ createdAt: -1 });
SearchEventSchema.index({ createdAt: -1, source: 1 });
SearchEventSchema.index({ createdAt: -1, queryHash: 1 });
SearchEventSchema.index({ createdAt: -1, topBusinessIds: 1 });

export const SearchEvent = models.SearchEvent || model("SearchEvent", SearchEventSchema);
