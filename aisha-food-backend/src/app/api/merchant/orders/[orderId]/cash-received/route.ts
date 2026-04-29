import mongoose from "mongoose";
import type { Document as MongoDocument, UpdateFilter } from "mongodb";
import { dbConnect } from "@/lib/mongodb";
import { ok, fail, readJson } from "@/lib/apiResponse";
import { requireMerchantSession } from "@/lib/merchantAuth";
import { requireMerchantBusinessAvailable } from "@/lib/merchantBusiness";
import { assertNotInMaintenance } from "@/lib/maintenance";
import { isDeliveryConfirmed } from "@/lib/orderPresentation";
import {
  getInitialPaymentProvider,
  normalizePaymentMethod,
  normalizePaymentStatus,
} from "@/lib/payment";
import { buildOrderEvent, buildOrderEventPush } from "@/lib/orderOperations";
import { DriverCashHandoff } from "@/models/DriverCashHandoff";
import { DriverCashHandoffAudit } from "@/models/DriverCashHandoffAudit";
import { Order } from "@/models/Order";
import { PaymentEvent } from "@/models/PaymentEvent";

type ApiError = Error & { status?: number; code?: string };

type Body = {
  confirm?: string;
  note?: string;
};

type OrderLean = {
  _id: mongoose.Types.ObjectId;
  cityId?: mongoose.Types.ObjectId | null;
  businessId: mongoose.Types.ObjectId;
  status?: string | null;
  total?: number | null;
  paymentStatus?: string | null;
  payment?: {
    method?: string | null;
    status?: string | null;
    paidAt?: Date | null;
    provider?: string | null;
    reference?: string | null;
  } | null;
  deliveryProof?: {
    required?: boolean | null;
    verifiedAt?: Date | null;
    verifiedBy?: "customer_code" | "admin_override" | null;
  } | null;
};

type HandoffLean = {
  _id: mongoose.Types.ObjectId;
  orderId: mongoose.Types.ObjectId;
  businessId: mongoose.Types.ObjectId;
  driverId: mongoose.Types.ObjectId;
  weekKey: string;
  amountCollectedRdp: number;
  status: "collected" | "handed_to_merchant" | "disputed" | "void";
  handedToMerchantAt?: Date | null;
  handedToMerchantBy?: string | null;
};

export async function POST(
  req: Request,
  { params }: { params: Promise<{ orderId: string }> }
) {
  try {
    await assertNotInMaintenance();

    const session = requireMerchantSession(req);
    await dbConnect();
    await requireMerchantBusinessAvailable(session.businessId);
    const { orderId } = await params;
    const body = await readJson<Body>(req);
    const confirm = String(body.confirm || "").trim();
    const note = String(body.note || "").trim().slice(0, 280);

    if (!mongoose.Types.ObjectId.isValid(orderId)) {
      return fail("VALIDATION_ERROR", "Invalid orderId.", 400);
    }
    if (confirm !== "RECEIVED") {
      return fail("VALIDATION_ERROR", "confirm must be RECEIVED.", 400);
    }

    const orderObjectId = new mongoose.Types.ObjectId(orderId);
    const businessObjectId = new mongoose.Types.ObjectId(session.businessId);
    const order = await Order.findOne({
      _id: orderObjectId,
      businessId: businessObjectId,
    })
      .select(
        "_id cityId businessId status total payment paymentStatus deliveryProof.required deliveryProof.verifiedAt deliveryProof.verifiedBy"
      )
      .lean<OrderLean | null>();
    if (!order) return fail("NOT_FOUND", "Order not found.", 404);

    const paymentMethod = normalizePaymentMethod(order.payment?.method || "cash");
    const paymentStatus = normalizePaymentStatus(
      order.payment?.status || order.paymentStatus || "pending"
    );
    if (paymentMethod !== "cash") {
      return fail(
        "INVALID_PAYMENT_METHOD",
        "Cash confirmation is only available for cash orders.",
        409
      );
    }
    if (paymentStatus === "paid") {
      return fail("ALREADY_CONFIRMED", "Cash was already confirmed for this order.", 409);
    }
    if (
      String(order.status || "").trim() === "cancelled" ||
      !isDeliveryConfirmed(order.status || "", order.deliveryProof)
    ) {
      return fail(
        "INVALID_STATE",
        "Cash can only be confirmed after delivery proof or fallback verification.",
        409
      );
    }

    const handoff = await DriverCashHandoff.findOne({
      orderId: order._id,
      businessId: order.businessId,
    }).lean<HandoffLean | null>();
    if (handoff && handoff.status === "void") {
      return fail(
        "INVALID_STATE",
        "Cash handoff is void and cannot be confirmed by the merchant.",
        409
      );
    }

    const now = new Date();
    const previousPayment = {
      method: paymentMethod,
      status: paymentStatus,
      paidAt: order.payment?.paidAt || null,
      provider:
        String(order.payment?.provider || "").trim() || getInitialPaymentProvider(paymentMethod),
      reference: String(order.payment?.reference || "").trim() || null,
    };
    const nextPayment = {
      method: paymentMethod,
      status: "paid",
      paidAt: now,
      provider: previousPayment.provider || "cash",
      reference:
        previousPayment.reference ||
        `merchant-cash-${String(order._id).slice(-6)}-${now.getTime()}`,
    };

    let updatedHandoff: HandoffLean | null = handoff;
    if (handoff && handoff.status !== "handed_to_merchant") {
      updatedHandoff = await DriverCashHandoff.findByIdAndUpdate(
        handoff._id,
        {
          $set: {
            status: "handed_to_merchant",
            handedToMerchantAt: now,
            handedToMerchantBy: "merchant",
          },
        },
        { returnDocument: "after" }
      ).lean<HandoffLean | null>();
      if (!updatedHandoff) {
        return fail("NOT_FOUND", "Driver cash handoff not found.", 404);
      }

      await DriverCashHandoffAudit.create({
        handoffId: handoff._id,
        orderId: handoff.orderId,
        businessId: handoff.businessId,
        driverId: handoff.driverId,
        weekKey: handoff.weekKey,
        action: "MARK_HANDED",
        actor: "merchant",
        meta: {
          amount: Number(handoff.amountCollectedRdp || 0),
          note: note || null,
        },
      });
    }

    const confirmOrderUpdate = ({
      $set: {
        payment: nextPayment,
        paymentStatus: "paid",
        updatedAt: now,
      },
      ...buildOrderEventPush(
        buildOrderEvent({
          type: "cash_received",
          label: "Cash received",
          detail: note || "Merchant confirmed cash collection.",
          actor: "merchant",
          createdAt: now,
        })
      ),
    } as unknown) as UpdateFilter<MongoDocument>;

    await Order.collection.updateOne(
      { _id: orderObjectId, businessId: businessObjectId },
      confirmOrderUpdate
    );

    try {
      if (order.cityId) {
        await PaymentEvent.create({
          orderId: order._id,
          cityId: order.cityId,
          method: paymentMethod,
          status: "paid",
          amount: Number(order.total || 0),
          provider: nextPayment.provider,
          reference: nextPayment.reference,
          notes: note || "Merchant cash confirmation",
          createdBy: "merchant",
        });
      }
    } catch (paymentEventError) {
      const rollbackOrderUpdate = {
        $set: {
          payment: previousPayment,
          paymentStatus: previousPayment.status,
          updatedAt: new Date(),
        },
      } as UpdateFilter<MongoDocument>;

      await Order.collection.updateOne(
        { _id: orderObjectId, businessId: businessObjectId },
        rollbackOrderUpdate
      );
      throw paymentEventError;
    }

    return ok({
      payment: {
        method: nextPayment.method,
        status: nextPayment.status,
        paidAt: nextPayment.paidAt,
        provider: nextPayment.provider || null,
        reference: nextPayment.reference || null,
      },
      handoff: updatedHandoff
        ? {
            id: String(updatedHandoff._id),
            status: updatedHandoff.status,
            handedToMerchantAt: updatedHandoff.handedToMerchantAt || null,
            handedToMerchantBy: updatedHandoff.handedToMerchantBy || null,
          }
        : null,
    });
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not mark cash as received.",
      err.status || 500
    );
  }
}
