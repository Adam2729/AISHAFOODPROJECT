/* eslint-disable @typescript-eslint/no-explicit-any */
import { dbConnect } from "@/lib/mongodb";
import { ok, fail } from "@/lib/apiResponse";
import { assertNotInMaintenance } from "@/lib/maintenance";
import { normalizePhone, phoneToHash } from "@/lib/phoneHash";
import { verifyOrderHistoryAccessToken } from "@/lib/orderHistoryAccess";
import { formatProductSizeLabel } from "@/lib/productCatalog";
import { requireUserSession } from "@/lib/userAuth";
import { Order } from "@/models/Order";

type HistoryBucket = {
  count: number;
  resetAt: number;
};

const HISTORY_LIMIT_DEFAULT = 10;
const HISTORY_LIMIT_MAX = 25;
const HISTORY_RATE_LIMIT = 30;
const HISTORY_RATE_WINDOW_MS = 10 * 60 * 1000;
const historyBuckets = new Map<string, HistoryBucket>();

function parseLimit(raw: string | null) {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return HISTORY_LIMIT_DEFAULT;
  return Math.max(1, Math.min(HISTORY_LIMIT_MAX, Math.floor(parsed)));
}

function consumeHistoryRateLimit(key: string) {
  const now = Date.now();
  const bucketKey = String(key || "").trim();
  if (!bucketKey) return { allowed: true };

  const current = historyBuckets.get(bucketKey);
  if (!current || now >= current.resetAt) {
    historyBuckets.set(bucketKey, {
      count: 1,
      resetAt: now + HISTORY_RATE_WINDOW_MS,
    });
    return { allowed: true };
  }

  current.count += 1;
  return { allowed: current.count <= HISTORY_RATE_LIMIT };
}

function mapSafeOrder(order: any) {
  const discountAmount = Number(order?.discount?.amount || 0);
  const subtotalBefore = Number(order?.discount?.subtotalBefore || 0);
  const subtotalAfter = Number(order?.discount?.subtotalAfter || order?.subtotal || 0);
  const deliveryFeeToCustomer = Number(order?.deliveryFeeToCustomer || 0);
  const total = Number(order?.total || 0);

  return {
    orderId: String(order?._id || ""),
    orderNumber: String(order?.orderNumber || ""),
    businessId: String(order?.businessId || ""),
    businessName: String(order?.businessName || ""),
    status: String(order?.status || ""),
    createdAt: order?.createdAt || null,
    totals: {
      ...(subtotalBefore > 0 ? { subtotalBefore } : {}),
      ...(discountAmount > 0 ? { discountAmount } : {}),
      ...(subtotalAfter > 0 ? { subtotalAfter } : {}),
      total,
      deliveryFeeToCustomer,
    },
    itemsSummary: Array.isArray(order?.items)
      ? order.items.map((item: any) => ({
          name: String(item?.name || ""),
          qty: Math.max(1, Number(item?.qty || 1)),
          unitPrice: Number(item?.unitPrice || 0),
          lineTotal: Number(item?.lineTotal || 0),
          displaySize: formatProductSizeLabel({
            displaySize: item?.displaySize,
            quantityValue: item?.quantityValue,
            quantityUnit: item?.quantityUnit,
          }),
          quantityValue: item?.quantityValue ?? null,
          quantityUnit: String(item?.quantityUnit || ""),
        }))
      : [],
    review: {
      rating:
        Number(order?.review?.rating || 0) >= 1 && Number(order?.review?.rating || 0) <= 5
          ? Number(order?.review?.rating || 0)
          : null,
      reviewedAt: order?.review?.reviewedAt || null,
    },
  };
}

export async function GET(req: Request) {
  try {
    await assertNotInMaintenance();
    const session = requireUserSession(req);
    const accessToken = String(req.headers.get("x-order-history-token") || "").trim();
    const access = verifyOrderHistoryAccessToken(accessToken);

    const url = new URL(req.url);
    const phone = String(url.searchParams.get("phone") || "").trim();
    const limit = parseLimit(url.searchParams.get("limit"));
    const normalizedPhone = phone ? normalizePhone(phone) : "";
    const phoneHash = normalizedPhone ? phoneToHash(normalizedPhone) : "";

    if (phone && !normalizedPhone) {
      return fail("VALIDATION_ERROR", "Invalid phone.", 400);
    }
    if (phoneHash && phoneHash !== session.phoneHash) {
      return fail(
        "UNAUTHORIZED",
        "Phone does not match the active customer session.",
        403
      );
    }
    if (!access) {
      return fail(
        "VERIFICATION_REQUIRED",
        "Order history now requires verified access from the checkout device.",
        401
      );
    }
    if (access.phoneHash !== session.phoneHash) {
      return fail("UNAUTHORIZED", "Verified history token does not match this customer session.", 403);
    }

    const rate = consumeHistoryRateLimit(`${session.phoneHash}:${access.sessionIdHash}`);
    if (!rate.allowed) {
      return fail("RATE_LIMIT", "Too many requests. Try later.", 429);
    }

    await dbConnect();
    let orders = await Order.find({ phoneHash: session.phoneHash })
      .select(
        "_id orderNumber businessId businessName status createdAt total deliveryFeeToCustomer items discount subtotal review"
      )
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    // Legacy fallback for old orders that may not have phoneHash persisted yet.
    if (!orders.length && normalizedPhone) {
      orders = await Order.find({ phone: normalizedPhone })
        .select(
          "_id orderNumber businessId businessName status createdAt total deliveryFeeToCustomer items discount subtotal review"
        )
        .sort({ createdAt: -1 })
        .limit(limit)
        .lean();
    }

    return ok({
      verified: true,
      orders: orders.map(mapSafeOrder),
    });
  } catch (error: unknown) {
    const err = error as Error & { status?: number; code?: string };
    const status = err.status || 500;
    return fail(err.code || "SERVER_ERROR", err.message || "Could not load order history.", status);
  }
}
