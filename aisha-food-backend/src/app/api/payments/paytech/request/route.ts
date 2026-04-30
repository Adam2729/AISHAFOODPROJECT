import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { ok, fail, readJson } from "@/lib/apiResponse";
import {
  createPayTechPayment,
  getPayTechDefaultCancelUrl,
  getPayTechDefaultSuccessUrl,
  getPayTechWebhookSecret,
} from "@/lib/paytech";
import { Order } from "@/models/Order";
import { PaymentEvent } from "@/models/PaymentEvent";

type ApiError = Error & { status?: number; code?: string };

type Body = {
  orderId?: string;
};

type OrderPaymentRow = {
  _id: mongoose.Types.ObjectId;
  orderNumber?: string | null;
  cityId?: mongoose.Types.ObjectId | null;
  total?: number | null;
  currency?: string | null;
  payment?: {
    method?: string | null;
    status?: string | null;
    provider?: string | null;
  } | null;
  paymentStatus?: string | null;
  paytechRefCommand?: string | null;
  paytechPaymentUrl?: string | null;
};

function normalizeText(value: unknown, max = 500) {
  return String(value || "").trim().slice(0, max);
}

function isSupportedPayTechCurrency(value: unknown) {
  const normalized = normalizeText(value, 12).toUpperCase();
  return normalized === "CFA" || normalized === "XOF" || normalized === "FCFA";
}

function resolveBackendBaseUrl(req: Request) {
  const explicit = normalizeText(process.env.PUBLIC_API_BASE_URL, 1200).replace(/\/+$/, "");
  if (explicit) return explicit;
  return new URL(req.url).origin.replace(/\/+$/, "");
}

function buildWebhookUrl(req: Request) {
  const baseUrl = resolveBackendBaseUrl(req);
  const url = new URL(`${baseUrl}/api/webhooks/paytech`);
  const webhookSecret = getPayTechWebhookSecret();
  if (webhookSecret) {
    url.searchParams.set("secret", webhookSecret);
  }
  return url.toString();
}

function buildRefCommand(order: OrderPaymentRow) {
  const base =
    normalizeText(order.orderNumber, 48).replace(/[^A-Z0-9\-_]/gi, "").toUpperCase() ||
    String(order._id);
  return `AF-${base}-${Date.now()}`;
}

export async function POST(req: Request) {
  try {
    await dbConnect();
    const body = await readJson<Body>(req);
    const orderId = normalizeText(body.orderId, 80);
    if (!mongoose.Types.ObjectId.isValid(orderId)) {
      return fail("VALIDATION_ERROR", "Valid orderId is required.", 400);
    }

    const order = await Order.findById(orderId)
      .select(
        "_id orderNumber cityId total currency payment.method payment.status payment.provider paymentStatus paytechRefCommand paytechPaymentUrl"
      )
      .lean<OrderPaymentRow | null>();
    if (!order) {
      return fail("NOT_FOUND", "Order not found.", 404);
    }

    const paymentMethod = normalizeText(order.payment?.method, 40).toLowerCase();
    const paymentStatus = normalizeText(
      order.payment?.status || order.paymentStatus,
      40
    ).toLowerCase();

    if (paymentMethod !== "paytech") {
      return fail("PAYMENT_METHOD_NOT_SUPPORTED", "Order is not configured for PayTech.", 409);
    }
    if (paymentStatus === "paid") {
      return fail("ORDER_ALREADY_PAID", "Order is already paid.", 409);
    }
    if (!isSupportedPayTechCurrency(order.currency)) {
      return fail("PAYTECH_CURRENCY_NOT_SUPPORTED", "PayTech checkout requires XOF/FCFA.", 409);
    }

    if (paymentStatus === "pending" && order.paytechPaymentUrl && order.paytechRefCommand) {
      return ok({
        paymentUrl: order.paytechPaymentUrl,
        refCommand: order.paytechRefCommand,
        paymentStatus: "pending",
      });
    }

    const refCommand = buildRefCommand(order);
    const paymentRequest = await createPayTechPayment({
      itemName: `AishaFood order ${normalizeText(order.orderNumber, 40) || String(order._id)}`,
      itemPrice: Math.round(Number(order.total || 0)),
      refCommand,
      currency: "XOF",
      successUrl: getPayTechDefaultSuccessUrl(),
      cancelUrl: getPayTechDefaultCancelUrl(),
      ipnUrl: buildWebhookUrl(req),
      customField: JSON.stringify({
        orderId: String(order._id),
        cityId: order.cityId ? String(order.cityId) : null,
      }),
    });

    await Order.updateOne(
      { _id: order._id },
      {
        $set: {
          "payment.method": "paytech",
          "payment.status": "pending",
          "payment.provider": "paytech",
          paymentStatus: "pending",
          paytechRefCommand: refCommand,
          paytechPaymentUrl: paymentRequest.paymentUrl,
          paytechRawStatus: "pending",
          failedAt: null,
        },
      }
    );

    await PaymentEvent.create({
      orderId: order._id,
      cityId: order.cityId,
      method: "paytech",
      status: "pending",
      amount: Number(order.total || 0),
      provider: "paytech",
      reference: refCommand,
      notes: "PayTech redirect initialized.",
      createdBy: "system",
    }).catch(() => null);

    return ok({
      paymentUrl: paymentRequest.paymentUrl,
      refCommand,
      paymentStatus: "pending",
    });
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not initialize PayTech payment.",
      err.status || 500
    );
  }
}
