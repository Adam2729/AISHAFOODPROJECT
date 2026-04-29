import { ok, fail } from "@/lib/apiResponse";
import { requireAdminKey } from "@/lib/adminAuth";
import { getDefaultCity } from "@/lib/city";
import { buildMarketFormattingProfile } from "@/lib/marketFormatting";
import {
  ENV_ALLOW_SEED,
  ENV_DEV_ALLOW_ORDER_LOCATION_BYPASS,
  ENV_DEV_LOCATION_BYPASS_UNSAFE_IN_PRODUCTION,
  ENV_LAUNCH_CITY_CODE,
  ENV_MULTICITY_ENABLE_BAMAKO,
  ENV_NODE_ENV,
  ENV_RUNTIME_STAGE,
  ENV_SUPPORT_WHATSAPP_CONFIGURED,
  ENV_SUPPORT_WHATSAPP_IS_PLACEHOLDER,
} from "@/lib/env";

type ApiError = Error & { status?: number; code?: string };

function normalizeDigits(value: unknown) {
  return String(value || "").replace(/\D+/g, "");
}

function normalizeCommaList(value: unknown) {
  return String(value || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function looksPlaceholderPublicApiBaseUrl(value: string) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return true;
  return (
    normalized.includes("your-live-host.com") ||
    normalized.includes("example.com") ||
    normalized.endsWith(".local") ||
    normalized.includes("localhost")
  );
}

export async function GET(req: Request) {
  try {
    requireAdminKey(req);
    const defaultCity = await getDefaultCity();
    const publicApiBaseUrl = String(process.env.PUBLIC_API_BASE_URL || "").trim();
    const supportWhatsApp = normalizeDigits(process.env.SUPPORT_WHATSAPP_E164);
    const supportConfigured =
      supportWhatsApp.length >= 7 &&
      supportWhatsApp !== "18090000000" &&
      supportWhatsApp !== "22300000000";
    const allowedOrigins = normalizeCommaList(process.env.PUBLIC_API_ALLOWED_ORIGINS);
    const deliveryModesSupported = ["self_delivery", "platform_driver"];
    const warnings: string[] = [];
    const runtimeStage = ENV_RUNTIME_STAGE;

    if (!supportConfigured || ENV_SUPPORT_WHATSAPP_IS_PLACEHOLDER) {
      warnings.push(
        runtimeStage === "production"
          ? "Support WhatsApp is missing or placeholder. Production support contact is not launch-ready."
          : runtimeStage === "preview"
            ? "Support WhatsApp is missing or placeholder. Preview can continue, but production is not launch-ready."
            : "Support WhatsApp is missing or placeholder. Allowed for local UK testing, but production is not launch-ready."
      );
    }
    if (looksPlaceholderPublicApiBaseUrl(publicApiBaseUrl)) {
      warnings.push("Public API base URL is missing or still points to a local/example host.");
    }
    if (!allowedOrigins.length) {
      warnings.push("PUBLIC_API_ALLOWED_ORIGINS is empty.");
    }
    if (ENV_ALLOW_SEED) {
      warnings.push("ALLOW_SEED is enabled. Disable seed mode before pilot go-live.");
    }
    if (ENV_DEV_ALLOW_ORDER_LOCATION_BYPASS) {
      warnings.push(
        ENV_DEV_LOCATION_BYPASS_UNSAFE_IN_PRODUCTION
          ? "DEV_ALLOW_ORDER_LOCATION_BYPASS is enabled. Unsafe for production. Live order creation must be blocked until it is disabled."
          : runtimeStage === "preview"
            ? "DEV_ALLOW_ORDER_LOCATION_BYPASS is enabled. Preview testing can continue, but this is unsafe for production."
            : "DEV_ALLOW_ORDER_LOCATION_BYPASS is enabled. Allowed for local UK testing only. Disable it before preview or production."
      );
    }
    if (!String(process.env.GOOGLE_MAPS_API_KEY || "").trim()) {
      warnings.push("Google Maps API key is missing.");
    }
    if (!String(process.env.CRON_SECRET || "").trim()) {
      warnings.push("CRON_SECRET is missing.");
    }

    return ok({
      market: buildMarketFormattingProfile(defaultCity),
      city: {
        id: String(defaultCity._id),
        code: String(defaultCity.code || ""),
        name: String(defaultCity.name || ""),
        country: String(defaultCity.country || ""),
      },
      readiness: {
        nodeEnv: ENV_NODE_ENV,
        runtimeStage,
        productionMode: ENV_NODE_ENV === "production",
        launchCityCode: ENV_LAUNCH_CITY_CODE,
        bamakoEnabled: ENV_MULTICITY_ENABLE_BAMAKO,
        supportWhatsAppConfigured: ENV_SUPPORT_WHATSAPP_CONFIGURED && supportConfigured,
        supportWhatsApp,
        publicApiBaseUrl: publicApiBaseUrl || null,
        publicApiBaseUrlConfigured: Boolean(publicApiBaseUrl),
        publicApiBaseUrlLooksPlaceholder: looksPlaceholderPublicApiBaseUrl(publicApiBaseUrl),
        publicApiAllowedOrigins: allowedOrigins,
        publicApiAllowedOriginsConfigured: allowedOrigins.length > 0,
        googleMapsConfigured: Boolean(String(process.env.GOOGLE_MAPS_API_KEY || "").trim()),
        cronConfigured: Boolean(String(process.env.CRON_SECRET || "").trim()),
        allowSeedEnabled: ENV_ALLOW_SEED,
        devLocationBypassEnabled: ENV_DEV_ALLOW_ORDER_LOCATION_BYPASS,
        devLocationBypassUnsafeInProduction: ENV_DEV_LOCATION_BYPASS_UNSAFE_IN_PRODUCTION,
        deliveryModesSupported,
      },
      warnings,
    });
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not load admin launch context.",
      err.status || 500
    );
  }
}
