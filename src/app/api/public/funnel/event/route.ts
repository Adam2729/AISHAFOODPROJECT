import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { ok, fail, readJson } from "@/lib/apiResponse";
import { assertNotInMaintenance } from "@/lib/maintenance";
import { BASE_LOCATION, MAX_RADIUS_KM } from "@/lib/constants";
import { getWeekKey, isWithinRadiusKm } from "@/lib/geo";
import { computeSubscriptionStatus } from "@/lib/subscription";
import { hashSessionId } from "@/lib/pii";
import { buildRateLimitIdentity } from "@/lib/rateLimit";
import { hit as hitRateLimit } from "@/lib/rateLimitStore";
import { attachRequestIdHeader, getOrCreateRequestId } from "@/lib/requestId";
import { FunnelEvent } from "@/models/FunnelEvent";
import { Business } from "@/models/Business";
import { OpsEvent } from "@/models/OpsEvent";

type ApiError = Error & { status?: number; code?: string };

type FunnelEventName =
  | "business_view"
  | "add_to_cart"
  | "checkout_start"
  | "order_success"
  | "order_fail";

type FunnelSource = "home" | "search" | "favorites" | "buy_again" | "reorder" | "unknown";

type FunnelBody = {
  event?: FunnelEventName;
  businessId?: string;
  source?: FunnelSource;
  sessionId?: string;
  meta?: {
    cartItemsCount?: number;
    cartSubtotal?: number;
    failCode?: string;
  };
};

const ALLOWED_EVENTS = new Set<FunnelEventName>([
  "business_view",
  "add_to_cart",
  "checkout_start",
  "order_success",
  "order_fail",
]);
const ALLOWED_SOURCES = new Set<FunnelSource>([
  "home",
  "search",
  "favorites",
  "buy_again",
  "reorder",
  "unknown",
]);

function safeNumber(value: unknown, min = 0, max = 100000) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(min, Math.min(max, parsed));
}

export async function POST(req: Request) {
  const requestId = getOrCreateRequestId(req);
  const withRequestId = <T extends Response>(response: T) =>
    attachRequestIdHeader(response, requestId);

  try {
    await assertNotInMaintenance();
    const body = await readJson<FunnelBody>(req);
    const event = String(body.event || "").trim() as FunnelEventName;
    const sourceRaw = String(body.source || "").trim() as FunnelSource;
    const source = ALLOWED_SOURCES.has(sourceRaw) ? sourceRaw : "unknown";
    const businessId = String(body.businessId || "").trim();
    const sessionId = String(body.sessionId || "").trim();

    if (!ALLOWED_EVENTS.has(event)) {
      return withRequestId(fail("VALIDATION_ERROR", "Invalid event.", 400));
    }
    if (!mongoose.Types.ObjectId.isValid(businessId)) {
      return withRequestId(fail("VALIDATION_ERROR", "Invalid businessId.", 400));
    }
    if (!sessionId) {
      return withRequestId(fail("VALIDATION_ERROR", "sessionId is required.", 400));
    }

    const sessionIdHash = hashSessionId(sessionId);
    const identity = buildRateLimitIdentity(req, { sessionId });
    const sessionRate = await hitRateLimit("public.funnel.session", sessionIdHash, {
      windowSec: 10 * 60,
      limit: 200,
    });
    if (!sessionRate.allowed) {
      const retryAfterSec = Math.max(
        1,
        Math.ceil((new Date(sessionRate.resetAtIso).getTime() - Date.now()) / 1000)
      );
      await dbConnect();
      await OpsEvent.create({
        type: "RATE_LIMIT_BLOCKED",
        severity: "low",
        weekKey: getWeekKey(new Date()),
        businessId: null,
        businessName: "system",
        meta: {
          route: "public.funnel.event",
          ipHash: identity.ipHash || null,
          sessionIdHash: identity.sessionIdHash || null,
          retryAfterSec,
        },
      }).catch(() => null);
      const response = withRequestId(fail("RATE_LIMIT", "Too many requests. Try later.", 429));
      response.headers.set("Retry-After", String(retryAfterSec));
      return response;
    }

    await dbConnect();
    const business = await Business.findById(businessId)
      .select("type isActive paused subscription location")
      .lean();
    if (!business || !business.isActive) {
      return withRequestId(fail("BUSINESS_NOT_AVAILABLE", "Business is not available.", 404));
    }
    const subscription = computeSubscriptionStatus(
      (business as { subscription?: Record<string, unknown> }).subscription || {}
    );
    if (subscription.status === "suspended") {
      return withRequestId(fail("BUSINESS_SUSPENDED", "Business is not available right now.", 403));
    }

    const businessLat = Number(
      (business as { location?: { coordinates?: [number, number] } }).location?.coordinates?.[1]
    );
    const businessLng = Number(
      (business as { location?: { coordinates?: [number, number] } }).location?.coordinates?.[0]
    );
    const inCluster =
      Number.isFinite(businessLat) &&
      Number.isFinite(businessLng) &&
      isWithinRadiusKm(BASE_LOCATION.lat, BASE_LOCATION.lng, businessLat, businessLng, MAX_RADIUS_KM);
    if (!inCluster) {
      return withRequestId(fail("BUSINESS_OUTSIDE_CLUSTER", "Business is outside coverage cluster.", 400));
    }

    const cartItemsCount = safeNumber(body.meta?.cartItemsCount, 0, 1000);
    const cartSubtotal = safeNumber(body.meta?.cartSubtotal, 0, 2000000);
    const failCode = String(body.meta?.failCode || "").trim().slice(0, 80) || null;

    try {
      await FunnelEvent.create({
        event,
        businessId: new mongoose.Types.ObjectId(businessId),
        businessType: String(
          (business as { type?: string }).type === "colmado" ? "colmado" : "restaurant"
        ),
        source,
        meta: {
          cartItemsCount,
          cartSubtotal,
          failCode,
        },
        sessionIdHash,
      });
      return withRequestId(ok({ recorded: true }));
    } catch {
      return withRequestId(ok({ recorded: false }));
    }
  } catch (error: unknown) {
    const err = error as ApiError;
    return withRequestId(
      fail(
        err.code || "SERVER_ERROR",
        err.message || "Could not record funnel event.",
        err.status || 500
      )
    );
  }
}
