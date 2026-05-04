import { z } from "zod";

const schema = z.object({
  MONGODB_URI: z.string().min(1, "MONGODB_URI is required"),
  ADMIN_KEY: z.string().min(1, "ADMIN_KEY is required"),
  JWT_SECRET: z.string().min(1, "JWT_SECRET is required"),
  BASE_LOCATION_LAT: z.coerce.number(),
  BASE_LOCATION_LNG: z.coerce.number(),
  BAMAKO_BASE_LAT: z.coerce.number().optional(),
  BAMAKO_BASE_LNG: z.coerce.number().optional(),
  MAX_RADIUS_KM: z.coerce.number().positive().default(8),
  MAINTENANCE_MODE: z.coerce.boolean().default(false),
  NODE_ENV: z.enum(["development", "production", "test"]).optional(),
  DEV_ALLOW_ORDER_LOCATION_BYPASS: z.coerce.boolean().default(false),

  COMMISSION_RATE_DEFAULT: z.coerce.number().default(0.08),
  SUBSCRIPTION_MONTHLY_RDP: z.coerce.number().default(1500),
  TRIAL_DAYS: z.coerce.number().default(90),
  GRACE_DAYS: z.coerce.number().default(14),
  REFERRALS_ENABLED: z.coerce.boolean().default(false),
  REFERRAL_NEW_CUSTOMER_BONUS_RDP: z.coerce.number().default(50),
  REFERRAL_REFERRER_BONUS_RDP: z.coerce.number().default(50),
  PROMO_MAX_PERCENT: z.coerce.number().default(50),
  PROMO_MAX_FIXED_RDP: z.coerce.number().default(500),
  PROMO_CODE_MAX_LEN: z.coerce.number().default(24),
  SUPPORT_WHATSAPP_E164: z.string().min(7).default("18090000000"),
  SUPPORT_WHATSAPP_DEFAULT_TEXT: z.string().default("Hola, necesito ayuda con mi pedido."),
  STATEMENT_SIGNING_SECRET: z.string().optional(),
  DRIVER_LINK_SECRET: z.string().optional(),
  PII_HASH_SECRET: z.string().optional(),
  PII_PHONE_RETENTION_DAYS: z.coerce.number().int().min(1).max(3650).default(30),
  ALLOW_SEED: z.coerce.boolean().default(false),
  MULTICITY_ENABLE_BAMAKO: z.coerce.boolean().default(false),
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
  REFERRALS_ENABLED: process.env.REFERRALS_ENABLED ?? false,
  REFERRAL_NEW_CUSTOMER_BONUS_RDP: process.env.REFERRAL_NEW_CUSTOMER_BONUS_RDP ?? 50,
  REFERRAL_REFERRER_BONUS_RDP: process.env.REFERRAL_REFERRER_BONUS_RDP ?? 50,
  PROMO_MAX_PERCENT: process.env.PROMO_MAX_PERCENT ?? 50,
  PROMO_MAX_FIXED_RDP: process.env.PROMO_MAX_FIXED_RDP ?? 500,
  PROMO_CODE_MAX_LEN: process.env.PROMO_CODE_MAX_LEN ?? 24,
  SUPPORT_WHATSAPP_E164: process.env.SUPPORT_WHATSAPP_E164 ?? "18090000000",
  SUPPORT_WHATSAPP_DEFAULT_TEXT:
    process.env.SUPPORT_WHATSAPP_DEFAULT_TEXT ?? "Hola, necesito ayuda con mi pedido.",
  STATEMENT_SIGNING_SECRET: process.env.STATEMENT_SIGNING_SECRET,
  DRIVER_LINK_SECRET: process.env.DRIVER_LINK_SECRET,
  PII_HASH_SECRET: process.env.PII_HASH_SECRET,
  PII_PHONE_RETENTION_DAYS: process.env.PII_PHONE_RETENTION_DAYS ?? 30,
  ALLOW_SEED: process.env.ALLOW_SEED ?? false,
  MULTICITY_ENABLE_BAMAKO: process.env.MULTICITY_ENABLE_BAMAKO ?? false,
});

if (!parsed.success) {
  throw new Error(`Invalid env config: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", ")}`);
}

const env = parsed.data;

if (env.DEV_ALLOW_ORDER_LOCATION_BYPASS) {
  console.warn(
    "[SECURITY WARNING] DEV_ALLOW_ORDER_LOCATION_BYPASS is ENABLED. " +
      "Order location checks are bypassed for local testing. Disable before production."
  );
}

if ((env.NODE_ENV ?? "development") === "production" && env.DEV_ALLOW_ORDER_LOCATION_BYPASS) {
  throw new Error(
    "Invalid env config: DEV_ALLOW_ORDER_LOCATION_BYPASS must be false in production."
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
export const ENV_DEV_ALLOW_ORDER_LOCATION_BYPASS = env.DEV_ALLOW_ORDER_LOCATION_BYPASS;

export const ENV_COMMISSION_RATE_DEFAULT = env.COMMISSION_RATE_DEFAULT;
export const ENV_SUBSCRIPTION_MONTHLY_RDP = env.SUBSCRIPTION_MONTHLY_RDP;
export const ENV_TRIAL_DAYS = env.TRIAL_DAYS;
export const ENV_GRACE_DAYS = env.GRACE_DAYS;
export const ENV_REFERRALS_ENABLED = env.REFERRALS_ENABLED;
export const ENV_REFERRAL_NEW_CUSTOMER_BONUS_RDP = env.REFERRAL_NEW_CUSTOMER_BONUS_RDP;
export const ENV_REFERRAL_REFERRER_BONUS_RDP = env.REFERRAL_REFERRER_BONUS_RDP;
export const ENV_PROMO_MAX_PERCENT = env.PROMO_MAX_PERCENT;
export const ENV_PROMO_MAX_FIXED_RDP = env.PROMO_MAX_FIXED_RDP;
export const ENV_PROMO_CODE_MAX_LEN = env.PROMO_CODE_MAX_LEN;
export const ENV_SUPPORT_WHATSAPP_E164 = env.SUPPORT_WHATSAPP_E164;
export const ENV_SUPPORT_WHATSAPP_DEFAULT_TEXT = env.SUPPORT_WHATSAPP_DEFAULT_TEXT;
export const ENV_STATEMENT_SIGNING_SECRET = env.STATEMENT_SIGNING_SECRET || env.JWT_SECRET;
export const ENV_DRIVER_LINK_SECRET = env.DRIVER_LINK_SECRET || env.JWT_SECRET;
export const ENV_PII_HASH_SECRET = env.PII_HASH_SECRET || env.JWT_SECRET;
export const ENV_PII_PHONE_RETENTION_DAYS = env.PII_PHONE_RETENTION_DAYS;
export const ENV_ALLOW_SEED = env.ALLOW_SEED;
export const ENV_MULTICITY_ENABLE_BAMAKO = env.MULTICITY_ENABLE_BAMAKO;
