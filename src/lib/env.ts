import { z } from "zod";

const schema = z.object({
  MONGODB_URI: z.string().min(1, "MONGODB_URI is required"),
  ADMIN_KEY: z.string().min(1, "ADMIN_KEY is required"),
  JWT_SECRET: z.string().min(1, "JWT_SECRET is required"),
  BASE_LOCATION_LAT: z.coerce.number(),
  BASE_LOCATION_LNG: z.coerce.number(),
  MAX_RADIUS_KM: z.coerce.number().positive().default(8),
  MAINTENANCE_MODE: z.coerce.boolean().default(false),
  NODE_ENV: z.enum(["development", "production", "test"]).optional(),

  COMMISSION_RATE_DEFAULT: z.coerce.number().default(0.08),
  SUBSCRIPTION_MONTHLY_RDP: z.coerce.number().default(1500),
  TRIAL_DAYS: z.coerce.number().default(90),
  GRACE_DAYS: z.coerce.number().default(14),
});

const parsed = schema.safeParse({
  MONGODB_URI: process.env.MONGODB_URI,
  ADMIN_KEY: process.env.ADMIN_KEY,
  JWT_SECRET: process.env.JWT_SECRET,
  BASE_LOCATION_LAT: process.env.BASE_LOCATION_LAT,
  BASE_LOCATION_LNG: process.env.BASE_LOCATION_LNG,
  MAX_RADIUS_KM: process.env.MAX_RADIUS_KM ?? 8,
  MAINTENANCE_MODE: process.env.MAINTENANCE_MODE,
  NODE_ENV: process.env.NODE_ENV,
  COMMISSION_RATE_DEFAULT: process.env.COMMISSION_RATE_DEFAULT ?? 0.08,
  SUBSCRIPTION_MONTHLY_RDP: process.env.SUBSCRIPTION_MONTHLY_RDP ?? 1500,
  TRIAL_DAYS: process.env.TRIAL_DAYS ?? 90,
  GRACE_DAYS: process.env.GRACE_DAYS ?? 14,
});

if (!parsed.success) {
  throw new Error(`Invalid env config: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", ")}`);
}

const env = parsed.data;

export const ENV_MONGODB_URI = env.MONGODB_URI;
export const ENV_ADMIN_KEY = env.ADMIN_KEY;
export const ENV_JWT_SECRET = env.JWT_SECRET;
export const ENV_BASE_LOCATION = {
  lat: env.BASE_LOCATION_LAT,
  lng: env.BASE_LOCATION_LNG,
} as const;
export const ENV_MAX_RADIUS_KM = env.MAX_RADIUS_KM;
export const ENV_MAINTENANCE_MODE = env.MAINTENANCE_MODE;
export const ENV_NODE_ENV = env.NODE_ENV ?? "development";

export const ENV_COMMISSION_RATE_DEFAULT = env.COMMISSION_RATE_DEFAULT;
export const ENV_SUBSCRIPTION_MONTHLY_RDP = env.SUBSCRIPTION_MONTHLY_RDP;
export const ENV_TRIAL_DAYS = env.TRIAL_DAYS;
export const ENV_GRACE_DAYS = env.GRACE_DAYS;
