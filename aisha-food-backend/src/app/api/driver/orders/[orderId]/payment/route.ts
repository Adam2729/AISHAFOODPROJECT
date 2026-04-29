import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { ok, fail, readJson } from "@/lib/apiResponse";
import { assertNotInMaintenance } from "@/lib/maintenance";
import { requireDriverCityContext } from "@/lib/driverContext";
import { DispatchAudit } from "@/models/DispatchAudit";
import { DriverAudit } from "@/models/DriverAudit";
import { Order } from "@/models/Order";

type ApiError = Error & { status?: number; code?: string };

type PaymentCollectionMethod =
  | "cash"
  | "orange_money"
  | "wave"
  | "moov_money"
  | "mobile_money";

type Body = {
  method?: string;
  provider?: string;
  reference?: string;
  note?: string;
};

const PAYMENT_METHODS = new Set<PaymentCollectionMethod>([
  "cash",
  "orange_money",
  "wave",
  "moov_money",
  "mobile_money",
]);

function cleanText(value: unknown, max: number) {
  return String(value || "").trim().slice(0, max);
}

function normalizeMethod(value: unknown): PaymentCollectionMethod | null {
  const normalized = String(value || "").trim().toLowerCase().replace(/\s+/g, "_");
  return PAYMENT_METHODS.has(normalized as PaymentCollectionMethod)
    ? (normalized as PaymentCollectionMethod)
    : null;
}

function providerLabel(method: PaymentCollectionMethod, provider: string) {
  if (provider) return provider;
  switch (method) {
    case "orange_money":
      return "Orange Money";
    case "wave":
      return "Wave";
    case "moov_money":
      return "Moov Money";
    case "mobile_money":
      return "Mobile Money";
    default:
      return "Cash";
  }
}

export async function POST(
  req: Request,
  context: { params: Promise<{ orderId: string }> }
) {
  try {
    await assertNotInMaintenance();
    await dbConnect();

    const { driver, city } = await requireDriverCityContext(req);
    const { orderId } = await context.params;
    if (!mongoose.Types.ObjectId.isValid(orderId)) {
      return fail("VALIDATION_ERROR", "Valid orderId is required.", 400);
    }

    const body = await readJson<Body>(req);
    const method = normalizeMethod(body.method);
    if (!method) {
      return fail(
        "VALIDATION_ERROR",
        "method must be cash, orange_money, wave, moov_money, or mobile_money.",
        400
      );
    }

    const provider = cleanText(body.provider, 80) || providerLabel(method, "");
    const reference = cleanText(body.reference, 120);
    const note = cleanText(body.note, 200);
    const cityIdObj = new mongoose.Types.ObjectId(String(city._id));
    const driverIdObj = new mongoose.Types.ObjectId(String(driver._id));
    const order = await Order.findOne({
      _id: new mongoose.Types.ObjectId(orderId),
      cityId: cityIdObj,
      "deliverySnapshot.mode": "platform_driver",
      "dispatch.assignedDriverId": driverIdObj,
      status: "out_for_delivery",
    })
      .select(
        "_id businessId status payment.method payment.status dispatch.paymentCollectedAt dispatch.paymentCollectionMethod dispatch.paymentCollectionProvider dispatch.paymentCollectionReference dispatch.paymentCollectionNote"
      )
      .lean<{
        _id: mongoose.Types.ObjectId;
        businessId: mongoose.Types.ObjectId;
        status?: string;
        payment?: {
          method?: string | null;
          status?: string | null;
        };
        dispatch?: {
          paymentCollectedAt?: Date | null;
          paymentCollectionMethod?: string | null;
          paymentCollectionProvider?: string | null;
          paymentCollectionReference?: string | null;
          paymentCollectionNote?: string | null;
        };
      } | null>();

    if (!order) {
      return fail("NOT_FOUND", "Out-for-delivery platform-driver order not found.", 404);
    }

    const collectedAt = order.dispatch?.paymentCollectedAt || new Date();
    const normalizedPaymentMethod = method === "cash" ? "cash" : "mobile_money";
    const paymentWasCollected = Boolean(order.dispatch?.paymentCollectedAt);

    await Order.updateOne(
      {
        _id: order._id,
        cityId: cityIdObj,
        "dispatch.assignedDriverId": driverIdObj,
        status: "out_for_delivery",
      },
      {
        $set: {
          "dispatch.paymentCollectedAt": collectedAt,
          "dispatch.paymentCollectionMethod": method,
          "dispatch.paymentCollectionProvider": provider,
          "dispatch.paymentCollectionReference": reference || null,
          "dispatch.paymentCollectionNote": note || null,
          "dispatch.cashCollectedByDriver": method === "cash",
          "payment.method": normalizedPaymentMethod,
          "payment.provider": provider,
          "payment.reference": reference || null,
          ...(method === "cash"
            ? {}
            : {
                "payment.status": "paid",
                paymentStatus: "paid",
                "payment.paidAt": collectedAt,
              }),
        },
      }
    );

    if (!paymentWasCollected) {
      await Promise.all([
        DriverAudit.create({
          cityId: cityIdObj,
          driverId: driverIdObj,
          orderId: order._id,
          action: "PAYMENT_COLLECTED",
          meta: {
            method,
            provider,
            reference: reference || null,
          },
        }),
        DispatchAudit.create({
          cityId: cityIdObj,
          orderId: order._id,
          businessId: order.businessId,
          driverId: driverIdObj,
          action: "PAYMENT_COLLECTED",
          actor: "driver",
          meta: {
            cityId: cityIdObj,
            driverId: driverIdObj,
            selectedDriverId: driverIdObj,
            note: note || provider,
          },
        }),
      ]);
    }

    return ok({
      orderId: String(order._id),
      paymentCollected: true,
      method,
      provider,
      reference: reference || null,
      note: note || null,
      collectedAt,
      idempotent: paymentWasCollected,
    });
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not confirm payment collection.",
      err.status || 500
    );
  }
}
