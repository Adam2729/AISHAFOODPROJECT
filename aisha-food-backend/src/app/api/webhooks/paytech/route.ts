import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { ok, fail } from "@/lib/apiResponse";
import { normalizePayTechStatus, verifyPayTechWebhook } from "@/lib/paytech";
import {
  queueCustomerOrderConfirmedNotification,
  queueMerchantNewOrderNotification,
  settleNotificationWrites,
} from "@/lib/notificationEvents";
import { Order } from "@/models/Order";
import { PaymentEvent } from "@/models/PaymentEvent";

type ApiError = Error & { status?: number; code?: string };

type PayTechOrderRow = {
  _id: mongoose.Types.ObjectId;
  cityId?: mongoose.Types.ObjectId | null;
  businessId?: mongoose.Types.ObjectId | null;
  businessName?: string | null;
  orderNumber?: string | null;
  phoneHash?: string | null;
  total?: number | null;
  status?: string | null;
  payment?: {
    method?: string | null;
    status?: string | null;
    provider?: string | null;
  } | null;
  paymentStatus?: string | null;
  paytechRefCommand?: string | null;
  dispatch?: {
    assignedDriverId?: mongoose.Types.ObjectId | null;
  } | null;
  deliverySnapshot?: {
    mode?: string | null;
  } | null;
};

function normalizeText(value: unknown, max = 2000) {
  return String(value || "").trim().slice(0, max);
}

function firstText(values: unknown[], max = 2000) {
  for (const value of values) {
    const text = normalizeText(value, max);
    if (text) return text;
  }
  return "";
}

function parseMaybeJson(value: string) {
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function parseMaybeBase64Json(value: string) {
  try {
    const decoded = Buffer.from(value, "base64").toString("utf8");
    return parseMaybeJson(decoded);
  } catch {
    return null;
  }
}

async function parsePayTechPayload(req: Request) {
  const rawText = await req.text();
  const contentType = normalizeText(req.headers.get("content-type"), 200).toLowerCase();
  if (!rawText) return { payload: {}, rawText: "" };

  if (contentType.includes("application/json")) {
    return {
      payload: parseMaybeJson(rawText) || {},
      rawText,
    };
  }

  const params = new URLSearchParams(rawText);
  const payload = Object.fromEntries(params.entries()) as Record<string, unknown>;
  return { payload, rawText };
}

function extractCustomField(payload: Record<string, unknown>) {
  const raw = firstText([payload.custom_field, payload.customField], 4000);
  if (!raw) return null;
  return parseMaybeJson(raw) || parseMaybeBase64Json(raw);
}

function extractAmount(payload: Record<string, unknown>) {
  const raw = firstText(
    [
      payload.amount,
      payload.item_price,
      payload.payment_amount,
      payload.total_amount,
      payload.montant,
    ],
    120
  );
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export async function POST(req: Request) {
  try {
    await dbConnect();
    const { payload, rawText } = await parsePayTechPayload(req);
    const webhookSecret = new URL(req.url).searchParams.get("secret");
    const verification = verifyPayTechWebhook({ payload, webhookSecret });
    if (!verification.ok) {
      return fail("FORBIDDEN", verification.reason || "Invalid PayTech webhook.", 403);
    }

    const refCommand = firstText(
      [payload.ref_command, payload.refCommand, payload.command_ref],
      120
    );
    const transactionId = firstText(
      [payload.payment_token, payload.transaction_id, payload.transactionId, payload.token],
      120
    ) || null;
    const normalizedStatus = normalizePayTechStatus(payload);
    const payloadAmount = extractAmount(payload);
    const customField = extractCustomField(payload);

    console.info("[PayTech webhook] received", {
      refCommand: refCommand || null,
      transactionId,
      status: normalizedStatus.normalized,
      rawStatus: normalizedStatus.rawStatus,
      amount: payloadAmount,
    });

    let order = refCommand
      ? await Order.findOne({ paytechRefCommand: refCommand })
          .select(
            "_id cityId businessId businessName orderNumber phoneHash total status payment.method payment.status payment.provider paymentStatus paytechRefCommand dispatch.assignedDriverId deliverySnapshot.mode"
          )
          .lean<PayTechOrderRow | null>()
      : null;

    if (!order && customField?.orderId && mongoose.Types.ObjectId.isValid(String(customField.orderId))) {
      order = await Order.findById(String(customField.orderId))
        .select(
          "_id cityId businessId businessName orderNumber phoneHash total status payment.method payment.status payment.provider paymentStatus paytechRefCommand dispatch.assignedDriverId deliverySnapshot.mode"
        )
        .lean<PayTechOrderRow | null>();
    }

    if (!order) {
      console.warn("[PayTech webhook] order not found", {
        refCommand: refCommand || null,
        transactionId,
        status: normalizedStatus.normalized,
        amount: payloadAmount,
      });
      return ok({
        received: true,
        orderFound: false,
      });
    }

    const currentPaymentStatus = normalizeText(
      order.payment?.status || order.paymentStatus,
      40
    ).toLowerCase();
    if (currentPaymentStatus === "paid") {
      console.info("[PayTech webhook] paid order already finalized", {
        orderId: String(order._id),
        refCommand: refCommand || order.paytechRefCommand || null,
        transactionId,
        currentPaymentStatus,
        incomingStatus: normalizedStatus.normalized,
      });
      return ok({ received: true, idempotent: true });
    }
    if (currentPaymentStatus === normalizedStatus.normalized) {
      console.info("[PayTech webhook] duplicate ignored", {
        orderId: String(order._id),
        refCommand: refCommand || order.paytechRefCommand || null,
        transactionId,
        status: normalizedStatus.normalized,
      });
      return ok({ received: true, idempotent: true });
    }

    const now = new Date();
    const baseUpdate: Record<string, unknown> = {
      "payment.method": "paytech",
      "payment.provider": "paytech",
      "payment.reference": transactionId || refCommand || null,
      paymentStatus: normalizedStatus.normalized,
      paytechRefCommand: refCommand || order.paytechRefCommand || null,
      paytechTransactionId: transactionId,
      paytechRawStatus: normalizedStatus.rawStatus,
      paytechWebhookReceivedAt: now,
      paytechWebhookPayload: payload,
    };

    if (normalizedStatus.normalized === "paid") {
      baseUpdate["payment.status"] = "paid";
      baseUpdate["payment.paidAt"] = now;
      baseUpdate["failedAt"] = null;
      if (normalizeText(order.status, 40).toLowerCase() === "pending_payment") {
        baseUpdate.status = "new";
      }
    } else if (normalizedStatus.normalized === "failed") {
      baseUpdate["payment.status"] = "failed";
      baseUpdate["failedAt"] = now;
      if (normalizeText(order.status, 40).toLowerCase() === "pending_payment") {
        baseUpdate.status = "cancelled";
      }
    } else if (normalizedStatus.normalized === "cancelled") {
      baseUpdate["payment.status"] = "cancelled";
      baseUpdate["failedAt"] = now;
      if (normalizeText(order.status, 40).toLowerCase() === "pending_payment") {
        baseUpdate.status = "cancelled";
      }
    } else {
      baseUpdate["payment.status"] = "pending";
    }

    await Order.updateOne({ _id: order._id }, { $set: baseUpdate });

    const amount = payloadAmount ?? Number(order.total || 0);
    await PaymentEvent.create({
      orderId: order._id,
      cityId: order.cityId,
      method: "paytech",
      status: normalizedStatus.normalized,
      amount,
      provider: "paytech",
      reference: transactionId || refCommand || null,
      notes:
        rawText.slice(0, 280) ||
        `PayTech webhook status: ${normalizedStatus.rawStatus || normalizedStatus.normalized}`,
      createdBy: "webhook",
    }).catch(() => null);

    if (normalizedStatus.normalized === "paid") {
      await settleNotificationWrites(
        "webhooks.paytech",
        [
          queueMerchantNewOrderNotification({
            orderId: order._id,
            orderNumber: order.orderNumber,
            businessId: order.businessId,
            businessName: order.businessName,
            cityId: order.cityId,
            customerPhoneHash: order.phoneHash || null,
            deliveryMode: order.deliverySnapshot?.mode || null,
            source: "webhooks.paytech",
            meta: {
              paymentMethod: "paytech",
              paymentStatus: "paid",
            },
          }),
          queueCustomerOrderConfirmedNotification({
            orderId: order._id,
            orderNumber: order.orderNumber,
            businessId: order.businessId,
            businessName: order.businessName,
            cityId: order.cityId,
            driverId: order.dispatch?.assignedDriverId || null,
            customerPhoneHash: order.phoneHash || null,
            deliveryMode: order.deliverySnapshot?.mode || null,
            source: "webhooks.paytech",
            meta: {
              paymentMethod: "paytech",
              paymentStatus: "paid",
            },
          }),
        ],
        {
          orderId: String(order._id),
          businessId: order.businessId ? String(order.businessId) : null,
        }
      );
    }

    return ok({
      received: true,
      orderFound: true,
      paymentStatus: normalizedStatus.normalized,
    });
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not process PayTech webhook.",
      err.status || 500
    );
  }
}
