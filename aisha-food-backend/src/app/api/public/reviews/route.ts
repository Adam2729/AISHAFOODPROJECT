import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { ok, fail, readJson } from "@/lib/apiResponse";
import { assertNotInMaintenance } from "@/lib/maintenance";
import { isDuplicateKeyError } from "@/lib/orderNumber";
import { logRequest } from "@/lib/logger";
import { normalizePhone, phoneToHash } from "@/lib/phoneHash";
import { normalizeComment, normalizeSource, validateRating } from "@/lib/reviews";
import { normalizeTags } from "@/lib/reviewTags";
import { getWeekKey } from "@/lib/geo";
import { buildRateLimitIdentity } from "@/lib/rateLimit";
import { hit as hitRateLimit } from "@/lib/rateLimitStore";
import { attachRequestIdHeader, getOrCreateRequestId } from "@/lib/requestId";
import { OpsEvent } from "@/models/OpsEvent";
import { Order } from "@/models/Order";
import { Review } from "@/models/Review";

type ApiError = Error & { status?: number; code?: string };

type Body = {
  phone?: string;
  sessionId?: string;
  orderId?: string;
  orderNumber?: string;
  rating?: number;
  tags?: string[];
  comment?: string;
  source?: string;
};

type OrderOwnershipRow = {
  _id: mongoose.Types.ObjectId;
  businessId: mongoose.Types.ObjectId;
  orderNumber: string;
  phoneHash?: string;
  phone?: string;
  status: string;
};

function normalizeString(value: unknown) {
  return String(value || "").trim();
}

function sameLegacyPhone(inputPhone: string, orderPhone: string) {
  const normalizedInput = normalizePhone(inputPhone);
  const normalizedOrder = normalizePhone(orderPhone);
  if (!normalizedInput || !normalizedOrder) return false;
  return normalizedInput === normalizedOrder;
}

export async function POST(req: Request) {
  const startedAt = Date.now();
  const requestId = getOrCreateRequestId(req);
  const finish = (
    response: Response,
    status: number,
    extra?: Record<string, unknown>
  ) => {
    const responseWithRequestId = attachRequestIdHeader(response, requestId);
    logRequest(req, {
      route: "public.reviews.create",
      status,
      durationMs: Date.now() - startedAt,
      requestId,
      extra,
    });
    return responseWithRequestId;
  };

  try {
    await assertNotInMaintenance();
    const body = await readJson<Body>(req);
    const phone = normalizeString(body.phone);
    const sessionId = normalizeString(body.sessionId);
    const orderId = normalizeString(body.orderId);
    const orderNumber = normalizeString(body.orderNumber);
    const rating = validateRating(body.rating);
    const tags = normalizeTags(body.tags);
    const comment = normalizeComment(body.comment);
    const source = normalizeSource(body.source);

    if (!phone) return finish(fail("VALIDATION_ERROR", "phone is required.", 400), 400);
    const normalizedPhone = normalizePhone(phone);
    if (!normalizedPhone) return finish(fail("VALIDATION_ERROR", "Invalid phone.", 400), 400);

    if (!orderId && !orderNumber) {
      return finish(
        fail("VALIDATION_ERROR", "orderId or orderNumber is required.", 400),
        400
      );
    }
    if (orderId && !mongoose.Types.ObjectId.isValid(orderId)) {
      return finish(fail("VALIDATION_ERROR", "Invalid orderId.", 400), 400);
    }
    if (!rating) return finish(fail("VALIDATION_ERROR", "rating must be an integer between 1 and 5.", 400), 400);

    const phoneHash = phoneToHash(normalizedPhone);
    const identity = buildRateLimitIdentity(req, { phoneHash, sessionId });
    const phoneRate = await hitRateLimit("public.reviews.phone", phoneHash, {
      windowSec: 10 * 60,
      limit: 6,
    });
    if (!phoneRate.allowed) {
      const retryAfterSec = Math.max(
        1,
        Math.ceil((new Date(phoneRate.resetAtIso).getTime() - Date.now()) / 1000)
      );
      await dbConnect();
      await OpsEvent.create({
        type: "RATE_LIMIT_BLOCKED",
        severity: "medium",
        weekKey: getWeekKey(new Date()),
        businessId: null,
        businessName: "system",
        meta: {
          route: "public.reviews.create",
          ipHash: identity.ipHash || null,
          sessionIdHash: identity.sessionIdHash || null,
          phoneHash: identity.phoneHash || null,
          retryAfterSec,
        },
      }).catch(() => null);
      const response = finish(
        fail("RATE_LIMIT", "Demasiadas solicitudes. Intenta de nuevo en unos minutos.", 429),
        429,
        {
          ipHash: identity.ipHash || null,
          sessionIdHash: identity.sessionIdHash || null,
          phoneHash: identity.phoneHash || null,
        }
      );
      response.headers.set("Retry-After", String(retryAfterSec));
      return response;
    }

    await dbConnect();
    const lookup: Record<string, unknown> = { status: "delivered" };
    if (orderId) lookup._id = new mongoose.Types.ObjectId(orderId);
    else lookup.orderNumber = orderNumber;

    const order = await Order.findOne(lookup)
      .select("_id businessId orderNumber phone phoneHash status")
      .lean<OrderOwnershipRow | null>();
    if (!order) {
      return finish(fail("NOT_FOUND", "Delivered order not found.", 404), 404);
    }

    const ownerByHash = Boolean(order.phoneHash) && String(order.phoneHash) === phoneHash;
    const ownerByLegacy = !order.phoneHash && sameLegacyPhone(phone, String(order.phone || ""));
    if (!ownerByHash && !ownerByLegacy) {
      return finish(fail("FORBIDDEN", "No autorizado para calificar este pedido.", 403), 403, {
        orderId: String(order._id),
      });
    }

    try {
      const created = await Review.create({
        businessId: order.businessId,
        orderId: order._id,
        rating,
        tags,
        comment,
        source,
        isHidden: false,
      });

      try {
        await Order.updateOne(
          {
            _id: order._id,
            $or: [{ "review.reviewedAt": { $exists: false } }, { "review.reviewedAt": null }],
          },
          {
            $set: {
              "review.rating": rating,
              "review.reviewedAt": new Date(),
            },
          }
        );
      } catch {
        // Do not fail review creation if snapshot update fails.
      }

      return finish(
        ok({
          review: {
            id: String(created._id),
            businessId: String(created.businessId),
            orderId: String(created.orderId),
            rating: Number(created.rating),
            tags: Array.isArray(created.tags) ? created.tags : [],
            comment: String(created.comment || ""),
            createdAt: created.createdAt,
          },
        }),
        200,
        { orderId: String(order._id), businessId: String(order.businessId) }
      );
    } catch (error: unknown) {
      if (!isDuplicateKeyError(error)) throw error;
      return finish(
        fail("ALREADY_REVIEWED", "Este pedido ya tiene una calificacion registrada.", 409),
        409,
        { orderId: String(order._id) }
      );
    }
  } catch (error: unknown) {
    const err = error as ApiError;
    const status = err.status || 500;
    return finish(
      fail(err.code || "SERVER_ERROR", err.message || "Could not submit review.", status),
      status
    );
  }
}
