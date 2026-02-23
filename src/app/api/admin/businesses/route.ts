/* eslint-disable @typescript-eslint/no-explicit-any */
import { dbConnect } from "@/lib/mongodb";
import { ok, fail, readJson } from "@/lib/apiResponse";
import { requireAdminKey } from "@/lib/adminAuth";
import { COMMISSION_RATE_DEFAULT, SUBSCRIPTION_MONTHLY_RDP, TRIAL_DAYS } from "@/lib/constants";
import { addDays, computeSubscriptionStatus } from "@/lib/subscription";
import { runSubscriptionStatusJob } from "@/lib/subscriptionJob";
import { hashSecret } from "@/lib/password";
import { Business } from "@/models/Business";

type ApiError = Error & { status?: number; code?: string };

type CreateBusinessBody = {
  type?: "restaurant" | "colmado";
  name?: string;
  phone?: string;
  whatsapp?: string;
  address?: string;
  lat?: number;
  lng?: number;
  logoUrl?: string;
  commissionRate?: number;
  pin?: string;
  password?: string;
  isDemo?: boolean;
};

export async function GET(req: Request) {
  try {
    requireAdminKey(req);
    await dbConnect();
    await runSubscriptionStatusJob();
    const businesses = await Business.find({}).sort({ createdAt: -1 }).lean();

    const rows = businesses.map((b: any) => {
      const sub = computeSubscriptionStatus(b.subscription || {});
      return {
        id: String(b._id),
        type: b.type,
        name: b.name,
        phone: b.phone,
        whatsapp: b.whatsapp,
        address: b.address,
        logoUrl: b.logoUrl || "",
        isActive: b.isActive,
        isDemo: Boolean(b.isDemo),
        commissionRate: b.commissionRate,
        subscription: {
          ...sub,
          trialDays: b.subscription?.trialDays ?? TRIAL_DAYS,
          graceDays: b.subscription?.graceDays ?? 14,
          monthlyFeeRdp: SUBSCRIPTION_MONTHLY_RDP,
        },
      };
    });
    return ok({ businesses: rows });
  } catch (e: unknown) {
    const err = e as ApiError;
    return fail(err.code || "SERVER_ERROR", err.message || "Could not list businesses.", err.status || 500);
  }
}

export async function POST(req: Request) {
  try {
    requireAdminKey(req);
    const body = await readJson<CreateBusinessBody>(req);

    const type = String(body.type || "").trim();
    const name = String(body.name || "").trim();
    const phone = String(body.phone || "").trim();
    const whatsapp = String(body.whatsapp || "").trim();
    const address = String(body.address || "").trim();
    const logoUrl = String(body.logoUrl || "").trim();
    const pin = String(body.pin || body.password || "").trim();
    const isDemo = Boolean(body.isDemo);
    const lat = Number(body.lat);
    const lng = Number(body.lng);
    const commissionRate = Number(body.commissionRate ?? COMMISSION_RATE_DEFAULT);

    if (!["restaurant", "colmado"].includes(type)) return fail("VALIDATION_ERROR", "Invalid business type.");
    if (!name || !phone || !address) return fail("VALIDATION_ERROR", "name, phone and address are required.");
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return fail("VALIDATION_ERROR", "Valid lat/lng required.");
    if (pin.length < 4) return fail("VALIDATION_ERROR", "PIN/password must be at least 4 chars.");

    await dbConnect();
    const trialStartedAt = new Date();
    const trialEndsAt = addDays(trialStartedAt, TRIAL_DAYS);
    const created = await Business.create({
      type,
      name,
      phone,
      whatsapp,
      address,
      logoUrl,
      location: { type: "Point", coordinates: [lng, lat] },
      isActive: true,
      isDemo,
      commissionRate: Number.isFinite(commissionRate) ? commissionRate : COMMISSION_RATE_DEFAULT,
      auth: { pinHash: hashSecret(pin), mustChange: true },
      subscription: {
        status: "trial",
        trialDays: TRIAL_DAYS,
        graceDays: 14,
        trialStartedAt,
        trialEndsAt,
        lastPaidAt: null,
        paidUntilAt: null,
      },
    });

    return ok({ business: created }, 201);
  } catch (e: unknown) {
    const err = e as ApiError;
    return fail(err.code || "SERVER_ERROR", err.message || "Could not create business.", err.status || 500);
  }
}
