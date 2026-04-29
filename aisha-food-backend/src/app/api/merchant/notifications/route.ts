import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { ok, fail, readJson } from "@/lib/apiResponse";
import { requireMerchantSession } from "@/lib/merchantAuth";
import { requireMerchantBusinessAvailable } from "@/lib/merchantBusiness";
import { NotificationEvent } from "@/models/NotificationEvent";

type ApiError = Error & { status?: number; code?: string };

type AckBody = {
  ids?: string[];
};

export const dynamic = "force-dynamic";

function normalizeText(value: unknown, max = 120) {
  return String(value || "").trim().slice(0, max);
}

function normalizeLimit(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 10;
  return Math.max(1, Math.min(50, Math.round(parsed)));
}

function parseSince(value: unknown) {
  const normalized = normalizeText(value, 80);
  if (!normalized) return null;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

export async function GET(req: Request) {
  try {
    const session = requireMerchantSession(req);
    if (!mongoose.Types.ObjectId.isValid(session.businessId)) {
      return fail("UNAUTHORIZED", "Invalid merchant session.", 401);
    }

    const url = new URL(req.url);
    const status = normalizeText(url.searchParams.get("status"), 20);
    const eventType = normalizeText(url.searchParams.get("eventType"), 80);
    const since = parseSince(url.searchParams.get("since"));
    const limit = normalizeLimit(url.searchParams.get("limit"));

    await dbConnect();
    await requireMerchantBusinessAvailable(session.businessId);

    const businessId = new mongoose.Types.ObjectId(session.businessId);
    const query: Record<string, unknown> = {
      audience: "merchant",
      businessId,
    };

    if (status === "pending" || status === "processed" || status === "cancelled") {
      query.status = status;
    }
    if (eventType) {
      query.eventType = eventType;
    }
    if (since) {
      query.createdAt = { $gt: since };
    }

    const rows = await NotificationEvent.find(query)
      .select(
        "eventType status deliveryMode title body orderId source meta processedAt cancelledAt createdAt updatedAt"
      )
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean<
        Array<{
          _id: mongoose.Types.ObjectId;
          eventType?: string;
          status?: string;
          deliveryMode?: string | null;
          title?: string;
          body?: string;
          orderId?: mongoose.Types.ObjectId | null;
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
        eventType: row.eventType || null,
        status: row.status || null,
        deliveryMode: row.deliveryMode || null,
        title: row.title || "",
        body: row.body || "",
        orderId: row.orderId ? String(row.orderId) : null,
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
      err.message || "Could not load merchant notifications.",
      err.status || 500
    );
  }
}

export async function POST(req: Request) {
  try {
    const session = requireMerchantSession(req);
    if (!mongoose.Types.ObjectId.isValid(session.businessId)) {
      return fail("UNAUTHORIZED", "Invalid merchant session.", 401);
    }

    const body = await readJson<AckBody>(req);
    const ids = Array.isArray(body.ids)
      ? body.ids
          .map((value) => String(value || "").trim())
          .filter((value) => mongoose.Types.ObjectId.isValid(value))
      : [];

    if (!ids.length) {
      return fail("VALIDATION_ERROR", "ids[] is required.", 400);
    }

    await dbConnect();
    await requireMerchantBusinessAvailable(session.businessId);

    const businessId = new mongoose.Types.ObjectId(session.businessId);
    const objectIds = ids.map((value) => new mongoose.Types.ObjectId(value));
    const now = new Date();

    const result = await NotificationEvent.updateMany(
      {
        _id: { $in: objectIds },
        audience: "merchant",
        businessId,
        status: "pending",
      },
      {
        $set: {
          status: "processed",
          processedAt: now,
        },
      }
    );

    return ok({
      processed: Number(result.modifiedCount || 0),
      ids,
    });
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not acknowledge merchant notifications.",
      err.status || 500
    );
  }
}
