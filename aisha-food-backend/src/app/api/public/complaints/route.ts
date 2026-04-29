import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { ok, fail, readJson } from "@/lib/apiResponse";
import { assertNotInMaintenance } from "@/lib/maintenance";
import { normalizePhone, phoneToHash } from "@/lib/phoneHash";
import { getWeekKey } from "@/lib/geo";
import { buildRateLimitIdentity } from "@/lib/rateLimit";
import { hit as hitRateLimit } from "@/lib/rateLimitStore";
import { attachRequestIdHeader, getOrCreateRequestId } from "@/lib/requestId";
import { Complaint } from "@/models/Complaint";
import { OpsEvent } from "@/models/OpsEvent";
import { Order } from "@/models/Order";

type ComplaintType = "late" | "wrong_item" | "no_response" | "other";

type Body = {
  phone?: string;
  sessionId?: string;
  orderId?: string;
  orderNumber?: string;
  type?: string;
  message?: string;
};

type ApiError = Error & { status?: number; code?: string };

type OrderLookup = {
  _id: mongoose.Types.ObjectId;
  orderNumber: string;
  businessId: mongoose.Types.ObjectId;
  businessName: string;
  phone?: string;
};

const ALLOWED_TYPES = new Set<ComplaintType>(["late", "wrong_item", "no_response", "other"]);

function normalizeString(value: unknown) {
  return String(value || "").trim();
}

function isDuplicateError(error: unknown) {
  const code = String((error as { code?: number | string })?.code || "");
  const message = String((error as { message?: string })?.message || "");
  return code === "11000" || /E11000/.test(message);
}

export async function POST(req: Request) {
  const requestId = getOrCreateRequestId(req);
  const withRequestId = <T extends Response>(response: T) =>
    attachRequestIdHeader(response, requestId);

  try {
    await assertNotInMaintenance();

    const body = await readJson<Body>(req);
    const phone = normalizeString(body.phone);
    const sessionId = normalizeString(body.sessionId);
    const orderId = normalizeString(body.orderId);
    const orderNumber = normalizeString(body.orderNumber);
    const type = normalizeString(body.type).toLowerCase();
    const message = normalizeString(body.message).slice(0, 300);

    if (!phone) return withRequestId(fail("VALIDATION_ERROR", "phone is required.", 400));
    if (!normalizePhone(phone)) return withRequestId(fail("VALIDATION_ERROR", "Invalid phone.", 400));
    if (!ALLOWED_TYPES.has(type as ComplaintType)) {
      return withRequestId(fail("VALIDATION_ERROR", "Invalid complaint type.", 400));
    }
    if (!message || message.length < 1) {
      return withRequestId(fail("VALIDATION_ERROR", "message is required.", 400));
    }
    if (!orderId && !orderNumber) {
      return withRequestId(fail("VALIDATION_ERROR", "orderId or orderNumber is required.", 400));
    }
    if (orderId && !mongoose.Types.ObjectId.isValid(orderId)) {
      return withRequestId(fail("VALIDATION_ERROR", "Invalid orderId.", 400));
    }

    const phoneHash = phoneToHash(phone);
    const identity = buildRateLimitIdentity(req, { phoneHash, sessionId });
    const phoneRate = await hitRateLimit("public.complaints.phone", phoneHash, {
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
          route: "public.complaints.create",
          ipHash: identity.ipHash || null,
          sessionIdHash: identity.sessionIdHash || null,
          phoneHash: identity.phoneHash || null,
          retryAfterSec,
        },
      }).catch(() => null);
      const response = withRequestId(fail("RATE_LIMIT", "Too many requests. Try later.", 429));
      response.headers.set("Retry-After", String(retryAfterSec));
      return response;
    }

    await dbConnect();

    const lookup: Record<string, unknown> = { phoneHash };
    if (orderId) lookup._id = new mongoose.Types.ObjectId(orderId);
    else lookup.orderNumber = orderNumber;

    let order = await Order.findOne(lookup)
      .select("_id orderNumber businessId businessName phone")
      .lean<OrderLookup | null>();

    // Legacy fallback for older orders without phoneHash.
    if (!order) {
      const legacyLookup: Record<string, unknown> = { phone };
      if (orderId) legacyLookup._id = new mongoose.Types.ObjectId(orderId);
      else legacyLookup.orderNumber = orderNumber;
      order = await Order.findOne(legacyLookup)
        .select("_id orderNumber businessId businessName phone")
        .lean<OrderLookup | null>();
    }

    if (!order) return withRequestId(fail("NOT_FOUND", "Order not found.", 404));

    try {
      const created = await Complaint.create({
        orderId: order._id,
        orderNumber: order.orderNumber,
        businessId: order.businessId,
        businessName: order.businessName,
        phoneHash,
        type,
        message,
        status: "open",
      });
      return withRequestId(ok({
        complaintId: String(created._id),
        status: "open",
      }));
    } catch (error: unknown) {
      if (!isDuplicateError(error)) throw error;
      const existing = await Complaint.findOne({ orderId: order._id }).select("_id status").lean();
      if (!existing) throw error;
      return withRequestId(ok({
        complaintId: String(existing._id),
        status: String(existing.status || "open"),
      }));
    }
  } catch (error: unknown) {
    const err = error as ApiError;
    return withRequestId(
      fail(err.code || "SERVER_ERROR", err.message || "Could not create complaint.", err.status || 500)
    );
  }
}
