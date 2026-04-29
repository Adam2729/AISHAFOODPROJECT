import mongoose from "mongoose";
import type { Document as MongoDocument, UpdateFilter } from "mongodb";
import { ok, fail, readJson } from "@/lib/apiResponse";
import { requireAdminKey } from "@/lib/adminAuth";
import { requireActiveCity, resolveCityFromRequest } from "@/lib/city";
import { dbConnect } from "@/lib/mongodb";
import {
  getInitialPaymentProvider,
  normalizePaymentMethod,
  normalizePaymentStatus,
} from "@/lib/payment";
import { Order } from "@/models/Order";
import { PaymentEvent } from "@/models/PaymentEvent";

type ApiError = Error & { status?: number; code?: string };

type UpdatePaymentBody = {
  status?: "paid" | "failed" | "refunded";
  provider?: string;
  reference?: string;
  notes?: string;
};

function normalizeString(value: unknown, maxLength = 120) {
  return String(value || "").trim().slice(0, maxLength);
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ orderId: string }> }
) {
  try {
    requireAdminKey(req);
    await dbConnect();
    const selectedCity = await resolveCityFromRequest(req);
    requireActiveCity(selectedCity);

    const { orderId } = await params;
    if (!mongoose.Types.ObjectId.isValid(orderId)) {
      return fail("VALIDATION_ERROR", "Invalid orderId.", 400);
    }

    const body = await readJson<UpdatePaymentBody>(req);
    const nextStatusRaw = normalizeString(body.status, 30).toLowerCase();
    if (!["paid", "failed", "refunded"].includes(nextStatusRaw)) {
      return fail("VALIDATION_ERROR", "status must be paid, failed, or refunded.", 400);
    }

    const cityObjectId = new mongoose.Types.ObjectId(String(selectedCity._id));
    const orderObjectId = new mongoose.Types.ObjectId(orderId);
    const order = await Order.findOne({
      _id: orderObjectId,
      cityId: cityObjectId,
    })
      .select("_id total payment paymentStatus")
      .lean<{
        _id: mongoose.Types.ObjectId;
        total?: number | null;
        paymentStatus?: string | null;
        payment?: {
          method?: string | null;
          status?: string | null;
          paidAt?: Date | null;
          provider?: string | null;
          reference?: string | null;
        } | null;
      } | null>();

    if (!order) {
      return fail("NOT_FOUND", "Order not found.", 404);
    }

    const method = normalizePaymentMethod(order.payment?.method || "cash");
    const previousPayment = {
      method,
      status: normalizePaymentStatus(order.payment?.status || "pending"),
      paidAt: order.payment?.paidAt || null,
      provider: String(order.payment?.provider || "").trim() || getInitialPaymentProvider(method),
      reference: String(order.payment?.reference || "").trim() || null,
    };
    const previousPaymentStatus = String(order.paymentStatus || order.payment?.status || "pending").trim() || "pending";
    const nextStatus = normalizePaymentStatus(nextStatusRaw);
    const provider =
      normalizeString(body.provider, 120) ||
      previousPayment.provider ||
      getInitialPaymentProvider(method);
    const reference = normalizeString(body.reference, 120) || previousPayment.reference || null;
    const notes = normalizeString(body.notes, 280) || null;
    const paidAt =
      nextStatus === "paid"
        ? new Date()
        : nextStatus === "failed"
          ? null
          : previousPayment.paidAt || null;
    const nextPayment = {
      method,
      status: nextStatus,
      paidAt,
      provider,
      reference,
    };

    const paymentUpdate = {
      $set: {
        payment: nextPayment,
        paymentStatus: nextStatus,
      },
    } as UpdateFilter<MongoDocument>;

    await Order.collection.updateOne(
      { _id: orderObjectId, cityId: cityObjectId },
      paymentUpdate
    );

    try {
      await PaymentEvent.create({
        orderId: orderObjectId,
        cityId: cityObjectId,
        method,
        status: nextStatus,
        amount: Number(order.total || 0),
        provider,
        reference,
        notes,
        createdBy: "admin",
      });
    } catch (paymentEventError) {
      const rollbackPaymentUpdate = {
        $set: {
          payment: previousPayment,
          paymentStatus: previousPaymentStatus,
        },
      } as UpdateFilter<MongoDocument>;

      await Order.collection.updateOne(
        { _id: orderObjectId, cityId: cityObjectId },
        rollbackPaymentUpdate
      );
      throw paymentEventError;
    }

    return ok({
      orderId,
      payment: {
        method: nextPayment.method,
        status: nextPayment.status,
        paidAt: nextPayment.paidAt,
        provider: nextPayment.provider || null,
        reference: nextPayment.reference || null,
      },
    });
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not update payment.",
      err.status || 500
    );
  }
}
