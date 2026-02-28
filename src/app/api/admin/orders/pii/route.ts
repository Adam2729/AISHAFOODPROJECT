import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { ok, fail } from "@/lib/apiResponse";
import { requireAdminKey } from "@/lib/adminAuth";
import { getWeekKey } from "@/lib/geo";
import { logRequest } from "@/lib/logger";
import { hashIp } from "@/lib/pii";
import { getClientIp } from "@/lib/rateLimit";
import { OpsEvent } from "@/models/OpsEvent";
import { Order } from "@/models/Order";

type ApiError = Error & { status?: number; code?: string };

export async function GET(req: Request) {
  const startedAt = Date.now();
  try {
    requireAdminKey(req);
    const url = new URL(req.url);
    const orderId = String(url.searchParams.get("orderId") || "").trim();
    const confirm = String(url.searchParams.get("confirm") || "").trim();
    const reason = String(url.searchParams.get("reason") || "").trim();

    if (!mongoose.Types.ObjectId.isValid(orderId)) {
      return fail("VALIDATION_ERROR", "Valid orderId is required.", 400);
    }
    if (confirm !== "REVEAL") {
      return fail("VALIDATION_ERROR", "confirm=REVEAL is required.", 400);
    }
    if (reason.length < 10) {
      return fail("VALIDATION_ERROR", "reason must be at least 10 characters.", 400);
    }

    await dbConnect();
    const order = await Order.findById(orderId)
      .select("_id businessId businessName orderNumber customerName phone address")
      .lean<{
        _id: mongoose.Types.ObjectId;
        businessId?: mongoose.Types.ObjectId | null;
        businessName?: string;
        orderNumber?: string;
        customerName?: string;
        phone?: string | null;
        address?: string;
      } | null>();

    if (!order) {
      return fail("NOT_FOUND", "Order not found.", 404);
    }

    const adminIpHash = hashIp(getClientIp(req));
    await OpsEvent.create({
      type: "ADMIN_PII_REVEAL",
      severity: "high",
      weekKey: getWeekKey(new Date()),
      businessId: order.businessId || null,
      businessName: String(order.businessName || ""),
      meta: {
        orderId: String(order._id),
        orderNumber: String(order.orderNumber || ""),
        reason,
        adminIpHash: adminIpHash || null,
      },
    });

    logRequest(req, {
      route: "admin.orders.pii.reveal",
      status: 200,
      durationMs: Date.now() - startedAt,
      extra: {
        orderId: String(order._id),
        businessId: order.businessId ? String(order.businessId) : null,
        adminIpHash: adminIpHash || null,
      },
    });

    return ok({
      orderId: String(order._id),
      businessId: order.businessId ? String(order.businessId) : null,
      orderNumber: String(order.orderNumber || ""),
      pii: {
        phone: order.phone || null,
        customerName: String(order.customerName || ""),
        address: String(order.address || ""),
      },
    });
  } catch (error: unknown) {
    const err = error as ApiError;
    const status = err.status || 500;
    logRequest(req, {
      route: "admin.orders.pii.reveal",
      status,
      durationMs: Date.now() - startedAt,
      extra: { message: err.message || "Could not reveal order PII." },
    });
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not reveal order PII.",
      status
    );
  }
}

