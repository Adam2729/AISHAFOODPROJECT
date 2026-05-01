import mongoose from "mongoose";
import { randomBytes } from "node:crypto";
import { createDriverLinkToken } from "@/lib/driverAuth";
import {
  ENV_ALLOW_SEED,
  ENV_DRIVER_LINK_TTL_HOURS,
  ENV_NODE_ENV,
} from "@/lib/env";
import { DriverSessionLink } from "@/models/DriverSessionLink";

export function generateTemporaryDriverPassword() {
  if (ENV_NODE_ENV !== "production" || ENV_ALLOW_SEED) {
    return "123456";
  }
  return randomBytes(6).toString("base64url").slice(0, 10);
}

export async function createDriverSessionLink(input: {
  driverId: mongoose.Types.ObjectId | string;
  cityId: mongoose.Types.ObjectId | string;
  origin: string;
  createdByAdminId?: string | null;
}) {
  const driverId = String(input.driverId || "").trim();
  const cityId = String(input.cityId || "").trim();
  if (!mongoose.Types.ObjectId.isValid(driverId)) {
    throw new Error("Valid driverId is required for a driver session link.");
  }
  if (!mongoose.Types.ObjectId.isValid(cityId)) {
    throw new Error("Valid cityId is required for a driver session link.");
  }

  const ttlHours = Math.max(1, Math.min(168, Number(ENV_DRIVER_LINK_TTL_HOURS || 24)));
  const { token, tokenHash } = createDriverLinkToken();
  const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000);

  await DriverSessionLink.create({
    cityId: new mongoose.Types.ObjectId(cityId),
    driverId: new mongoose.Types.ObjectId(driverId),
    tokenHash,
    expiresAt,
    createdByAdminId: String(input.createdByAdminId || "admin_key").trim() || "admin_key",
  });

  const normalizedOrigin = String(input.origin || "").trim().replace(/\/+$/, "");
  const linkUrl = `${normalizedOrigin}/driver/link?token=${encodeURIComponent(token)}&cityId=${encodeURIComponent(
    cityId
  )}`;
  const whatsappText =
    `AishaFood driver login link (valid ${ttlHours}h): ${linkUrl}\n` +
    "Open it to start your driver session.";

  return {
    linkUrl,
    whatsappText,
    expiresAt: expiresAt.toISOString(),
  };
}
