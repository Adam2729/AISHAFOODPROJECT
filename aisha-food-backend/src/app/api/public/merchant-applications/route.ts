import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { ok, fail, readJson } from "@/lib/apiResponse";
import { sendEmail, formatE164ForDisplay } from "@/lib/email";
import { assertNotInMaintenance } from "@/lib/maintenance";
import { requireActiveCity, resolveCityFromRequest } from "@/lib/city";
import { getMarketConfig } from "@/lib/marketConfig";
import {
  normalizeDeliveryType,
  normalizeMerchantType,
  normalizePayoutMethod,
} from "@/lib/merchantOnboarding";
import { hashSecret } from "@/lib/password";
import { MerchantApplication } from "@/models/MerchantApplication";

type ApiError = Error & { status?: number; code?: string };

type Body = {
  merchantType?: string;
  deliveryType?: string;
  deliveryModePreference?: string;
  businessName?: string;
  ownerName?: string;
  phone?: string;
  email?: string;
  password?: string;
  whatsapp?: string;
  country?: string;
  cityName?: string;
  area?: string;
  address?: string;
  cuisineType?: string;
  storeCategory?: string;
  openingHoursText?: string;
  averagePrepMinutes?: number;
  minimumOrderAmount?: number;
  deliveryRadiusKm?: number;
  logoUrl?: string;
  coverImageUrl?: string;
  legalIdNumber?: string;
  businessRegistrationNumber?: string;
  payoutMethod?: string;
  payoutDetails?: string;
  referredByCode?: string;
  notes?: string;
};

function normalize(value: unknown, max: number, required = false) {
  const v = String(value || "").trim();
  if (!v && required) return "";
  return v.slice(0, max);
}

function normalizeNumber(value: unknown, fallback: number, max: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.min(parsed, max);
}

function normalizeDeliveryModePreference(value: unknown) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "platform_driver") return "platform_driver";
  if (normalized === "both") return "both";
  return "self_delivery";
}

function resolveCanonicalDeliveryType(input: {
  deliveryType?: unknown;
  deliveryModePreference: "self_delivery" | "platform_driver" | "both";
  marketCode?: unknown;
}) {
  if (input.deliveryModePreference === "platform_driver") {
    return "platform_driver" as const;
  }
  if (input.deliveryModePreference === "self_delivery") {
    return "own_driver" as const;
  }
  return normalizeDeliveryType(input.deliveryType, input.marketCode);
}

function buildMerchantConfirmationEmail(input: {
  businessName: string;
  cityName: string;
  supportWhatsApp: string;
}) {
  const lines = [
    `Hello ${input.businessName},`,
    "",
    "Thank you for applying to join AishaFood.",
    "We have received your restaurant application successfully.",
    `City: ${input.cityName}`,
    "",
    "Our onboarding team will review your information and contact you with the next steps.",
    "Both delivery options can be supported when configured during onboarding: self_delivery and platform_driver.",
  ];

  if (input.supportWhatsApp) {
    lines.push("", `Support WhatsApp: ${input.supportWhatsApp}`);
  }

  lines.push("", "AishaFood Team");
  return lines.join("\n");
}

export async function POST(req: Request) {
  try {
    await assertNotInMaintenance();
    const city = await resolveCityFromRequest(req);
    requireActiveCity({
      isActive: Boolean(city.isActive),
      code: String(city.code || ""),
      name: String(city.name || ""),
      country: String(city.country || ""),
    });

    await dbConnect();

    const body = await readJson<Body>(req);
    const market = getMarketConfig(city);
    const merchantType = normalizeMerchantType(body.merchantType);
    const deliveryModePreference = normalizeDeliveryModePreference(
      body.deliveryModePreference || body.deliveryType
    );
    const deliveryType = resolveCanonicalDeliveryType({
      deliveryType: body.deliveryType,
      deliveryModePreference,
      marketCode: market.marketCode,
    });
    const businessName = normalize(body.businessName, 120, true);
    const ownerName = normalize(body.ownerName, 120, true);
    const phone = normalize(body.phone, 40, true);
    const email = normalize(body.email, 160, true).toLowerCase();
    const password = String(body.password || "").trim();
    const whatsapp = normalize(body.whatsapp, 40, false);
    const country = normalize(body.country, 80, false) || String(city.country || "");
    const cityName = normalize(body.cityName, 80, false) || String(city.name || "");
    const area = normalize(body.area, 120, false);
    const address = normalize(body.address, 200, false);
    const cuisineType = normalize(body.cuisineType, 80, false);
    const storeCategory = normalize(body.storeCategory, 80, false);
    const openingHoursText = normalize(body.openingHoursText, 500, false);
    const averagePrepMinutes = normalizeNumber(body.averagePrepMinutes, 15, 240);
    const minimumOrderAmount = normalizeNumber(body.minimumOrderAmount, 0, 1000000);
    const deliveryRadiusKm = normalizeNumber(
      body.deliveryRadiusKm,
      Number(city.maxDeliveryRadiusKm || 8),
      200
    );
    const logoUrl = normalize(body.logoUrl, 500, false);
    const coverImageUrl = normalize(body.coverImageUrl, 500, false);
    const legalIdNumber = normalize(body.legalIdNumber, 80, false);
    const businessRegistrationNumber = normalize(body.businessRegistrationNumber, 120, false);
    const payoutMethod = normalizePayoutMethod(body.payoutMethod);
    const payoutDetails = normalize(body.payoutDetails, 400, false);
    const referredByCode = normalize(body.referredByCode, 24, false).toUpperCase();
    const notes = normalize(body.notes, 400, false);

    if (!businessName || !ownerName || !phone || !email || !address) {
      return fail(
        "VALIDATION_ERROR",
        "businessName, ownerName, phone, email, and address are required.",
        400
      );
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return fail("VALIDATION_ERROR", "email must be valid.", 400);
    }
    if (password && password.length < 6) {
      return fail("VALIDATION_ERROR", "password must be at least 6 characters.", 400);
    }

    const created = await MerchantApplication.create({
      cityId: new mongoose.Types.ObjectId(String(city._id)),
      merchantType,
      deliveryType,
      deliveryModePreference,
      businessName,
      ownerName,
      phone,
      email,
      passwordHash: password ? hashSecret(password) : "",
      whatsapp,
      country,
      cityName,
      area,
      address,
      cuisineType,
      storeCategory,
      openingHoursText,
      averagePrepMinutes,
      minimumOrderAmount,
      deliveryRadiusKm,
      logoUrl,
      coverImageUrl,
      legalIdNumber,
      businessRegistrationNumber,
      payoutMethod,
      payoutDetails,
      referredByCode,
      notes,
      status: "pending",
      confirmationEmailStatus: "pending",
    });

    const supportWhatsApp = market.supportWhatsAppIsPlaceholder
      ? ""
      : formatE164ForDisplay(market.supportWhatsApp);
    const emailResult = await sendEmail({
      to: email,
      subject: "AishaFood restaurant application received",
      text: buildMerchantConfirmationEmail({
        businessName,
        cityName,
        supportWhatsApp,
      }),
    });

    await MerchantApplication.updateOne(
      { _id: created._id },
      {
        $set: {
          confirmationEmailStatus: emailResult.status,
          confirmationEmailProvider: emailResult.provider,
          confirmationEmailSentAt:
            emailResult.status === "sent" ? new Date() : null,
          confirmationEmailError: emailResult.error || "",
        },
      }
    ).catch((updateError: unknown) => {
      console.error(
        "Could not persist merchant application email status:",
        updateError instanceof Error ? updateError.message : String(updateError)
      );
    });

    return ok(
      {
        applicationId: String(created._id),
        status: "pending",
        cityId: String(city._id),
        cityCode: String(city.code || ""),
        merchantType,
        deliveryType,
        deliveryModePreference,
        confirmationEmail: emailResult,
      },
      201
    );
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(err.code || "SERVER_ERROR", err.message || "Could not submit application.", err.status || 500);
  }
}
