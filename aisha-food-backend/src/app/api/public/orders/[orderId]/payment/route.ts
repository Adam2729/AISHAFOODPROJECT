import mongoose from "mongoose";
import { ok, fail } from "@/lib/apiResponse";
import { requireActiveCity, resolveCityFromRequest } from "@/lib/city";
import { dbConnect } from "@/lib/mongodb";
import { normalizePaymentMethod, normalizePaymentStatus } from "@/lib/payment";
import { Order } from "@/models/Order";
import { PaymentEvent } from "@/models/PaymentEvent";

type ApiError = Error & { status?: number; code?: string };

export async function GET(
  req: Request,
  { params }: { params: Promise<{ orderId: string }> }
) {
  try {
    await dbConnect();
    const selectedCity = await resolveCityFromRequest(req);
    requireActiveCity(selectedCity);

    const { orderId } = await params;
    if (!mongoose.Types.ObjectId.isValid(orderId)) {
      return fail("VALIDATION_ERROR", "Invalid orderId.", 400);
    }

    const cityObjectId = new mongoose.Types.ObjectId(String(selectedCity._id));
    const orderObjectId = new mongoose.Types.ObjectId(orderId);

    const order = await Order.findOne({
      _id: orderObjectId,
      cityId: cityObjectId,
    })
      .select("_id payment")
      .lean<{
        _id: mongoose.Types.ObjectId;
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

    const events = await PaymentEvent.find({
      orderId: orderObjectId,
      cityId: cityObjectId,
    })
      .sort({ createdAt: -1, _id: -1 })
      .select("method status amount provider reference createdAt")
      .lean<
        Array<{
          method?: string | null;
          status?: string | null;
          amount?: number | null;
          provider?: string | null;
          reference?: string | null;
          createdAt?: Date | null;
        }>
      >();

    return ok({
      orderId: String(order._id),
      payment: {
        method: normalizePaymentMethod(order.payment?.method || "cash"),
        status: normalizePaymentStatus(order.payment?.status || "pending"),
        paidAt: order.payment?.paidAt || null,
        provider: String(order.payment?.provider || "").trim() || null,
        reference: String(order.payment?.reference || "").trim() || null,
      },
      events: events.map((event) => ({
        method: normalizePaymentMethod(event.method || "cash"),
        status: normalizePaymentStatus(event.status || "pending"),
        amount: Number(event.amount || 0),
        provider: String(event.provider || "").trim() || null,
        reference: String(event.reference || "").trim() || null,
        createdAt: event.createdAt || null,
      })),
    });
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not load payment status.",
      err.status || 500
    );
  }
}
