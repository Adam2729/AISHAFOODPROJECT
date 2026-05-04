import { dbConnect } from "@/lib/mongodb";
import {
  getBoolSetting,
  getNumberSetting,
  setNumberSetting,
  setStringSetting,
} from "@/lib/appSettings";
import { Product } from "@/models/Product";

export async function runAutoHideProductsJob() {
  await dbConnect();
  const [autoHideEnabled, autoHideDays, autoHideNeverSoldEnabled] = await Promise.all([
    getBoolSetting("auto_hide_enabled", true),
    getNumberSetting("auto_hide_days", 30),
    getBoolSetting("auto_hide_never_sold_enabled", true),
  ]);
  const safeDays = Math.max(1, Math.min(365, Math.round(Number(autoHideDays || 30))));
  const timestamp = new Date().toISOString();

  if (!autoHideEnabled) {
    await Promise.all([
      setStringSetting("auto_hide_last_run_at", timestamp),
      setNumberSetting("auto_hide_last_scanned", 0),
      setNumberSetting("auto_hide_last_hidden", 0),
    ]);
    return {
      ran: false,
      scanned: 0,
      hidden: 0,
      timestamp,
      autoHideDays: safeDays,
      autoHideEnabled,
      autoHideNeverSoldEnabled,
    };
  }

  const cutoff = new Date(Date.now() - safeDays * 24 * 60 * 60 * 1000);
  const staleFilters: Array<Record<string, unknown>> = [
    { stockHint: "out" },
    { lastSoldAt: { $lt: cutoff } },
  ];

  if (autoHideNeverSoldEnabled) {
    staleFilters.push({
      $and: [{ lastSoldAt: { $in: [null] } }, { createdAt: { $lt: cutoff } }],
    });
  }

  const query = {
    isAvailable: true,
    $or: staleFilters,
  };

  const scanned = await Product.countDocuments(query);
  const updateResult = await Product.updateMany(query, {
    $set: {
      isAvailable: false,
      unavailableReason: "out_of_stock",
      unavailableUpdatedAt: new Date(),
      stockHint: "out",
    },
  });
  const hidden = Number(updateResult.modifiedCount || 0);

  await Promise.all([
    setStringSetting("auto_hide_last_run_at", timestamp),
    setNumberSetting("auto_hide_last_scanned", Number(scanned || 0)),
    setNumberSetting("auto_hide_last_hidden", hidden),
  ]);

  return {
    ran: true,
    scanned: Number(scanned || 0),
    hidden,
    timestamp,
    autoHideDays: safeDays,
    autoHideEnabled,
    autoHideNeverSoldEnabled,
  };
}
