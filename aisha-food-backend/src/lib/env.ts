import { z } from "zod";

const boolFromEnv = z.preprocess((value) => {
  if (typeof value === "boolean") return value;

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();

    if (["true", "1", "yes", "on"].includes(normalized)) return true;
    if (["false", "0", "no", "off", ""].includes(normalized)) return false;
  }

  return value;
}, z.boolean());

const schema = z.object({
  MONGODB_URI: z.string().min(1, "MONGODB_URI is required"),
  ADMIN_KEY: z.string().min(1, "ADMIN_KEY is required"),
  JWT_SECRET: z.string().min(1, "JWT_SECRET is required"),
  BASE_LOCATION_LAT: z.coerce.number(),
  BASE_LOCATION_LNG: z.coerce.number(),
  BAMAKO_BASE_LAT: z.coerce.number().optional(),
  BAMAKO_BASE_LNG: z.coerce.number().optional(),
  MAX_RADIUS_KM: z.coerce.number().positive().default(8),
  MAINTENANCE_MODE: boolFromEnv.default(false),
  NODE_ENV: z.enum(["development", "production", "test"]).optional(),
  DEV_ALLOW_ORDER_LOCATION_BYPASS: boolFromEnv.default(false),

  COMMISSION_RATE_DEFAULT: z.coerce.number().default(0.08),
  SUBSCRIPTION_MONTHLY_RDP: z.coerce.number().default(1500),
  TRIAL_DAYS: z.coerce.number().default(90),
  GRACE_DAYS: z.coerce.number().default(14),
  LAUNCH_CITY_CODE: z.string().default("BKO"),
  REFERRALS_ENABLED: boolFromEnv.default(false),
  REFERRAL_NEW_CUSTOMER_BONUS_RDP: z.coerce.number().default(50),
  REFERRAL_REFERRER_BONUS_RDP: z.coerce.number().default(50),
  PROMO_MAX_PERCENT: z.coerce.number().default(50),
  PROMO_MAX_FIXED_RDP: z.coerce.number().default(500),
  PROMO_CODE_MAX_LEN: z.coerce.number().default(24),
  SUPPORT_WHATSAPP_E164: z.string().default(""),
  SUPPORT_WHATSAPP_DEFAULT_TEXT: z.string().default("Hola, necesito ayuda con mi pedido."),
  PAYTECH_API_KEY: z.string().optional(),
  PAYTECH_SECRET_KEY: z.string().optional(),
  PAYTECH_MODE: z.enum(["test", "prod"]).default("test"),
  PAYTECH_BASE_URL: z.string().default("https://paytech.sn/api"),
  PAYTECH_WEBHOOK_SECRET: z.string().optional(),
  PAYTECH_SUCCESS_URL: z.string().optional(),
  PAYTECH_CANCEL_URL: z.string().optional(),
  WHATSAPP_PROVIDER: z.string().optional(),
  WHATSAPP_API_TOKEN: z.string().optional(),
  WHATSAPP_FROM_NUMBER: z.string().optional(),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  EMAIL_FROM: z.string().optional(),
  STATEMENT_SIGNING_SECRET: z.string().optional(),
  DRIVER_LINK_SECRET: z.string().optional(),
  DRIVER_JWT_SECRET: z.string().optional(),
  DRIVER_LINK_TTL_HOURS: z.coerce.number().int().min(1).max(168).default(24),
  PII_HASH_SECRET: z.string().optional(),
  PII_PHONE_RETENTION_DAYS: z.coerce.number().int().min(1).max(3650).default(30),
  ALLOW_SEED: boolFromEnv.default(false),
  MULTICITY_ENABLE_BAMAKO: boolFromEnv.default(true),
  ALLOW_ADMIN_PAY_DISABLED_CITY: boolFromEnv.default(false),
});

const parsed = schema.safeParse({
  MONGODB_URI: process.env.MONGODB_URI,
  ADMIN_KEY: process.env.ADMIN_KEY,
  JWT_SECRET: process.env.JWT_SECRET,
  BASE_LOCATION_LAT: process.env.BASE_LOCATION_LAT,
  BASE_LOCATION_LNG: process.env.BASE_LOCATION_LNG,
  BAMAKO_BASE_LAT: process.env.BAMAKO_BASE_LAT,
  BAMAKO_BASE_LNG: process.env.BAMAKO_BASE_LNG,
  MAX_RADIUS_KM: process.env.MAX_RADIUS_KM ?? 8,
  MAINTENANCE_MODE: process.env.MAINTENANCE_MODE,
  NODE_ENV: process.env.NODE_ENV,
  DEV_ALLOW_ORDER_LOCATION_BYPASS: process.env.DEV_ALLOW_ORDER_LOCATION_BYPASS ?? false,
  COMMISSION_RATE_DEFAULT: process.env.COMMISSION_RATE_DEFAULT ?? 0.08,
  SUBSCRIPTION_MONTHLY_RDP: process.env.SUBSCRIPTION_MONTHLY_RDP ?? 1500,
  TRIAL_DAYS: process.env.TRIAL_DAYS ?? 90,
  GRACE_DAYS: process.env.GRACE_DAYS ?? 14,
  LAUNCH_CITY_CODE: process.env.LAUNCH_CITY_CODE ?? "BKO",
  REFERRALS_ENABLED: process.env.REFERRALS_ENABLED ?? false,
  REFERRAL_NEW_CUSTOMER_BONUS_RDP: process.env.REFERRAL_NEW_CUSTOMER_BONUS_RDP ?? 50,
  REFERRAL_REFERRER_BONUS_RDP: process.env.REFERRAL_REFERRER_BONUS_RDP ?? 50,
  PROMO_MAX_PERCENT: process.env.PROMO_MAX_PERCENT ?? 50,
  PROMO_MAX_FIXED_RDP: process.env.PROMO_MAX_FIXED_RDP ?? 500,
  PROMO_CODE_MAX_LEN: process.env.PROMO_CODE_MAX_LEN ?? 24,
  SUPPORT_WHATSAPP_E164: process.env.SUPPORT_WHATSAPP_E164 ?? "",
  SUPPORT_WHATSAPP_DEFAULT_TEXT:
    process.env.SUPPORT_WHATSAPP_DEFAULT_TEXT ?? "Hola, necesito ayuda con mi pedido.",
  PAYTECH_API_KEY: process.env.PAYTECH_API_KEY,
  PAYTECH_SECRET_KEY: process.env.PAYTECH_SECRET_KEY,
  PAYTECH_MODE: process.env.PAYTECH_MODE ?? "test",
  PAYTECH_BASE_URL: process.env.PAYTECH_BASE_URL ?? "https://paytech.sn/api",
  PAYTECH_WEBHOOK_SECRET: process.env.PAYTECH_WEBHOOK_SECRET,
  PAYTECH_SUCCESS_URL: process.env.PAYTECH_SUCCESS_URL,
  PAYTECH_CANCEL_URL: process.env.PAYTECH_CANCEL_URL,
  WHATSAPP_PROVIDER: process.env.WHATSAPP_PROVIDER,
  WHATSAPP_API_TOKEN: process.env.WHATSAPP_API_TOKEN,
  WHATSAPP_FROM_NUMBER: process.env.WHATSAPP_FROM_NUMBER,
  SMTP_HOST: process.env.SMTP_HOST,
  SMTP_PORT: process.env.SMTP_PORT,
  SMTP_USER: process.env.SMTP_USER,
  SMTP_PASS: process.env.SMTP_PASS,
  EMAIL_FROM: process.env.EMAIL_FROM,
  STATEMENT_SIGNING_SECRET: process.env.STATEMENT_SIGNING_SECRET,
  DRIVER_LINK_SECRET: process.env.DRIVER_LINK_SECRET,
  DRIVER_JWT_SECRET: process.env.DRIVER_JWT_SECRET,
  DRIVER_LINK_TTL_HOURS: process.env.DRIVER_LINK_TTL_HOURS ?? 24,
  PII_HASH_SECRET: process.env.PII_HASH_SECRET,
  PII_PHONE_RETENTION_DAYS: process.env.PII_PHONE_RETENTION_DAYS ?? 30,
  ALLOW_SEED: process.env.ALLOW_SEED ?? false,
  MULTICITY_ENABLE_BAMAKO: process.env.MULTICITY_ENABLE_BAMAKO ?? true,
  ALLOW_ADMIN_PAY_DISABLED_CITY: process.env.ALLOW_ADMIN_PAY_DISABLED_CITY ?? false,
});

if (!parsed.success) {
  throw new Error(`Invalid env config: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", ")}`);
}

const env = parsed.data;

type RuntimeStage = "development" | "preview" | "production";

function normalizeText(value: unknown) {
  return String(value || "").trim();
}

function inferRuntimeStage(): RuntimeStage {
  const explicitStage = normalizeText(
    process.env.APP_ENV || process.env.VERCEL_ENV || process.env.DEPLOY_ENV
  ).toLowerCase();
  if (explicitStage === "production") return "production";
  if (explicitStage === "preview" || explicitStage === "staging") return "preview";

  const publicApiBaseUrl = normalizeText(process.env.PUBLIC_API_BASE_URL).toLowerCase();
  if (publicApiBaseUrl && /(preview|staging|qa|sandbox|test|dev)/.test(publicApiBaseUrl)) {
    return "preview";
  }

  if (process.env.NEXT_PHASE === "phase-production-build") {
    return "development";
  }

  return (env.NODE_ENV ?? "development") === "production"
    ? "production"
    : "development";
}

function logEnvMessageOnce(
  key: string,
  level: "warn" | "error",
  message: string
) {
  const runtime = globalThis as typeof globalThis & {
    __aishaEnvWarnings?: Set<string>;
  };
  if (!runtime.__aishaEnvWarnings) {
    runtime.__aishaEnvWarnings = new Set();
  }
  if (runtime.__aishaEnvWarnings.has(key)) return;
  runtime.__aishaEnvWarnings.add(key);
  console[level](message);
}

const runtimeStage = inferRuntimeStage();
const isProductionRuntime =
  runtimeStage === "production" &&
  process.env.NEXT_PHASE !== "phase-production-build";
const PLACEHOLDER_SUPPORT_NUMBERS = new Set(["18090000000", "22300000000"]);
const normalizedSupportWhatsApp = String(env.SUPPORT_WHATSAPP_E164 || "").replace(/\D+/g, "");
const supportWhatsAppConfigured =
  normalizedSupportWhatsApp.length >= 7 &&
  !PLACEHOLDER_SUPPORT_NUMBERS.has(normalizedSupportWhatsApp);
const devLocationBypassUnsafeInProduction =
  isProductionRuntime && env.DEV_ALLOW_ORDER_LOCATION_BYPASS;

if (env.DEV_ALLOW_ORDER_LOCATION_BYPASS) {
  logEnvMessageOnce(
    "DEV_ALLOW_ORDER_LOCATION_BYPASS",
    "warn",
    runtimeStage === "production"
      ? "[CONFIG WARNING] DEV_ALLOW_ORDER_LOCATION_BYPASS is ENABLED. Unsafe for production. Orders will continue, but this should be disabled for live Bamako orders."
      : runtimeStage === "preview"
        ? "[CONFIG WARNING] DEV_ALLOW_ORDER_LOCATION_BYPASS is ENABLED. Preview testing can continue, but this is unsafe for production."
        : "[CONFIG WARNING] DEV_ALLOW_ORDER_LOCATION_BYPASS is ENABLED. Allowed for local UK testing only. Disable it before preview or production."
  );
}

if (!supportWhatsAppConfigured) {
  logEnvMessageOnce(
    "SUPPORT_WHATSAPP_E164",
    runtimeStage === "production" ? "error" : "warn",
    runtimeStage === "production"
      ? "[CONFIG ERROR] SUPPORT_WHATSAPP_E164 is missing or placeholder. Production support contact is not launch-ready."
      : runtimeStage === "preview"
        ? "[CONFIG WARNING] SUPPORT_WHATSAPP_E164 is missing or placeholder. Preview can continue, but production is not launch-ready."
        : "[CONFIG WARNING] SUPPORT_WHATSAPP_E164 is missing or placeholder. Local/dev testing can continue, but production is not launch-ready."
  );
}

export const ENV_MONGODB_URI = env.MONGODB_URI;
export const ENV_ADMIN_KEY = env.ADMIN_KEY;
export const ENV_JWT_SECRET = env.JWT_SECRET;
export const ENV_BASE_LOCATION = {
  lat: env.BASE_LOCATION_LAT,
  lng: env.BASE_LOCATION_LNG,
} as const;
export const ENV_BAMAKO_BASE_LOCATION = {
  lat: Number.isFinite(Number(env.BAMAKO_BASE_LAT)) ? Number(env.BAMAKO_BASE_LAT) : null,
  lng: Number.isFinite(Number(env.BAMAKO_BASE_LNG)) ? Number(env.BAMAKO_BASE_LNG) : null,
} as const;
export const ENV_MAX_RADIUS_KM = env.MAX_RADIUS_KM;
export const ENV_MAINTENANCE_MODE = env.MAINTENANCE_MODE;
export const ENV_NODE_ENV = env.NODE_ENV ?? "development";
export const ENV_RUNTIME_STAGE = runtimeStage;
export const ENV_DEV_ALLOW_ORDER_LOCATION_BYPASS = env.DEV_ALLOW_ORDER_LOCATION_BYPASS;
export const ENV_DEV_LOCATION_BYPASS_UNSAFE_IN_PRODUCTION =
  devLocationBypassUnsafeInProduction;

export const ENV_COMMISSION_RATE_DEFAULT = env.COMMISSION_RATE_DEFAULT;
export const ENV_SUBSCRIPTION_MONTHLY_RDP = env.SUBSCRIPTION_MONTHLY_RDP;
export const ENV_TRIAL_DAYS = env.TRIAL_DAYS;
export const ENV_GRACE_DAYS = env.GRACE_DAYS;
export const ENV_LAUNCH_CITY_CODE = String(env.LAUNCH_CITY_CODE || "").trim().toUpperCase() || "BKO";
export const ENV_REFERRALS_ENABLED = env.REFERRALS_ENABLED;
export const ENV_REFERRAL_NEW_CUSTOMER_BONUS_RDP = env.REFERRAL_NEW_CUSTOMER_BONUS_RDP;
export const ENV_REFERRAL_REFERRER_BONUS_RDP = env.REFERRAL_REFERRER_BONUS_RDP;
export const ENV_PROMO_MAX_PERCENT = env.PROMO_MAX_PERCENT;
export const ENV_PROMO_MAX_FIXED_RDP = env.PROMO_MAX_FIXED_RDP;
export const ENV_PROMO_CODE_MAX_LEN = env.PROMO_CODE_MAX_LEN;
export const ENV_SUPPORT_WHATSAPP_E164 = normalizedSupportWhatsApp;
export const ENV_SUPPORT_WHATSAPP_IS_PLACEHOLDER = !supportWhatsAppConfigured;
export const ENV_SUPPORT_WHATSAPP_CONFIGURED = supportWhatsAppConfigured;
export const ENV_SUPPORT_WHATSAPP_DEFAULT_TEXT = env.SUPPORT_WHATSAPP_DEFAULT_TEXT;
export const ENV_PAYTECH_API_KEY = normalizeText(env.PAYTECH_API_KEY) || null;
export const ENV_PAYTECH_SECRET_KEY = normalizeText(env.PAYTECH_SECRET_KEY) || null;
export const ENV_PAYTECH_MODE = env.PAYTECH_MODE;
export const ENV_PAYTECH_BASE_URL =
  normalizeText(env.PAYTECH_BASE_URL) || "https://paytech.sn/api";
export const ENV_PAYTECH_WEBHOOK_SECRET = normalizeText(env.PAYTECH_WEBHOOK_SECRET) || null;
export const ENV_PAYTECH_SUCCESS_URL = normalizeText(env.PAYTECH_SUCCESS_URL) || null;
export const ENV_PAYTECH_CANCEL_URL = normalizeText(env.PAYTECH_CANCEL_URL) || null;
export const ENV_WHATSAPP_PROVIDER = normalizeText(env.WHATSAPP_PROVIDER) || null;
export const ENV_WHATSAPP_API_TOKEN = normalizeText(env.WHATSAPP_API_TOKEN) || null;
export const ENV_WHATSAPP_FROM_NUMBER = normalizeText(env.WHATSAPP_FROM_NUMBER) || null;
export const ENV_SMTP_HOST = normalizeText(env.SMTP_HOST) || null;
export const ENV_SMTP_PORT = Number.isFinite(Number(env.SMTP_PORT))
  ? Number(env.SMTP_PORT)
  : null;
export const ENV_SMTP_USER = normalizeText(env.SMTP_USER) || null;
export const ENV_SMTP_PASS = normalizeText(env.SMTP_PASS) || null;
export const ENV_EMAIL_FROM = normalizeText(env.EMAIL_FROM) || null;
export const ENV_STATEMENT_SIGNING_SECRET = env.STATEMENT_SIGNING_SECRET || env.JWT_SECRET;
export const ENV_DRIVER_LINK_SECRET = env.DRIVER_LINK_SECRET || env.JWT_SECRET;
export const ENV_DRIVER_JWT_SECRET = env.DRIVER_JWT_SECRET || env.JWT_SECRET;
export const ENV_DRIVER_LINK_TTL_HOURS = env.DRIVER_LINK_TTL_HOURS;
export const ENV_PII_HASH_SECRET = env.PII_HASH_SECRET || env.JWT_SECRET;
export const ENV_PII_PHONE_RETENTION_DAYS = env.PII_PHONE_RETENTION_DAYS;
export const ENV_ALLOW_SEED = env.ALLOW_SEED;
export const ENV_MULTICITY_ENABLE_BAMAKO = env.MULTICITY_ENABLE_BAMAKO;
export const ENV_ALLOW_ADMIN_PAY_DISABLED_CITY = env.ALLOW_ADMIN_PAY_DISABLED_CITY;
