import mongoose from "mongoose";
import { ok, fail } from "@/lib/apiResponse";
import { requireAdminKey } from "@/lib/adminAuth";
import { dbConnect } from "@/lib/mongodb";
import { NotificationEvent } from "@/models/NotificationEvent";

type ApiError = Error & { status?: number; code?: string };

function normalizeText(value: unknown, max = 120) {
  return String(value || "").trim().slice(0, max);
}

function normalizeLimit(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 50;
  return Math.max(1, Math.min(200, Math.round(parsed)));
}

export async function GET(req: Request) {
  try {
    requireAdminKey(req);
    await dbConnect();

    const url = new URL(req.url);
    const audience = normalizeText(url.searchParams.get("audience"), 20);
    const status = normalizeText(url.searchParams.get("status"), 20);
    const eventType = normalizeText(url.searchParams.get("eventType"), 80);
    const orderId = normalizeText(url.searchParams.get("orderId"), 40);
    const businessId = normalizeText(url.searchParams.get("businessId"), 40);
    const limit = normalizeLimit(url.searchParams.get("limit"));

    const query: Record<string, unknown> = {};
    if (audience === "merchant" || audience === "customer") {
      query.audience = audience;
    }
    if (status === "pending" || status === "processed" || status === "cancelled") {
      query.status = status;
    }
    if (eventType) {
      query.eventType = eventType;
    }
    if (mongoose.Types.ObjectId.isValid(orderId)) {
      query.orderId = new mongoose.Types.ObjectId(orderId);
    }
    if (mongoose.Types.ObjectId.isValid(businessId)) {
      query.businessId = new mongoose.Types.ObjectId(businessId);
    }

    const rows = await NotificationEvent.find(query)
      .select(
        "audience eventType status deliveryMode title body cityId businessId orderId driverId suggestedChannels source meta processedAt cancelledAt createdAt updatedAt"
      )
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean<
        Array<{
          _id: mongoose.Types.ObjectId;
          audience?: string;
          eventType?: string;
          status?: string;
          deliveryMode?: string | null;
          title?: string;
          body?: string;
          cityId?: mongoose.Types.ObjectId | null;
          businessId?: mongoose.Types.ObjectId | null;
          orderId?: mongoose.Types.ObjectId | null;
          driverId?: mongoose.Types.ObjectId | null;
          suggestedChannels?: string[];
          source?: string | null;
          meta?: Record<string, unknown> | null;
          processedAt?: Date | null;
          cancelledAt?: Date | null;
          createdAt?: Date | null;
          updatedAt?: Date | null;
        }>
      >();

    return ok({
      rows: rows.map((row) => ({
        id: String(row._id),
        audience: row.audience || null,
        eventType: row.eventType || null,
        status: row.status || null,
        deliveryMode: row.deliveryMode || null,
        title: row.title || "",
        body: row.body || "",
        cityId: row.cityId ? String(row.cityId) : null,
        businessId: row.businessId ? String(row.businessId) : null,
        orderId: row.orderId ? String(row.orderId) : null,
        driverId: row.driverId ? String(row.driverId) : null,
        suggestedChannels: Array.isArray(row.suggestedChannels) ? row.suggestedChannels : [],
        source: row.source || null,
        meta: row.meta || null,
        processedAt: row.processedAt || null,
        cancelledAt: row.cancelledAt || null,
        createdAt: row.createdAt || null,
        updatedAt: row.updatedAt || null,
      })),
    });
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not load notification events.",
      err.status || 500
    );
  }
}
