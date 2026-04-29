import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { ok, fail, readJson } from "@/lib/apiResponse";
import { requireAdminKey } from "@/lib/adminAuth";
import { assertNotInMaintenance } from "@/lib/maintenance";
import { requireActiveCity } from "@/lib/city";
import { City } from "@/models/City";
import { Order } from "@/models/Order";

type ApiError = Error & { status?: number; code?: string };

type Body = {
  orderId?: string;
};

function sanitizeNote(value: unknown, fallback = "Pickup: confirmar con el negocio.") {
  const text = String(value || "").trim();
  return text || fallback;
}

export async function POST(req: Request) {
  try {
    requireAdminKey(req);
    await assertNotInMaintenance();
    await dbConnect();

    const body = await readJson<Body>(req);
    const orderId = String(body.orderId || "").trim();
    if (!mongoose.Types.ObjectId.isValid(orderId)) {
      return fail("VALIDATION_ERROR", "Valid orderId is required.", 400);
    }

    const order = await Order.findById(new mongoose.Types.ObjectId(orderId))
      .select("_id orderNumber businessName dispatch.handoffNote deliverySnapshot note cityId")
      .lean<{
        _id: mongoose.Types.ObjectId;
        orderNumber?: string;
        businessName?: string;
        cityId?: mongoose.Types.ObjectId | null;
        dispatch?: { handoffNote?: string | null };
        deliverySnapshot?: { noteEs?: string | null };
      } | null>();

    if (!order || !order.cityId) {
      return fail("NOT_FOUND", "Order not found.", 404);
    }

    const city = await City.findById(order.cityId)
      .select("_id code name isActive country currency")
      .lean<{ _id: mongoose.Types.ObjectId; code?: string; name?: string; isActive?: boolean; country?: string; currency?: string } | null>();
    if (!city) {
      return fail("CITY_NOT_FOUND", "City not found for order.", 404);
    }
    requireActiveCity({
      isActive: Boolean(city.isActive),
      code: String(city.code || ""),
      name: String(city.name || ""),
      country: String(city.country || ""),
    });

    const url = new URL(req.url);
    const baseUrl = `${url.protocol}//${url.host}`;
    const driverLinkUrl = `${baseUrl}/driver?cityId=${encodeURIComponent(
      String(city._id)
    )}&orderId=${encodeURIComponent(String(order._id))}`;
    const note =
      sanitizeNote(order.dispatch?.handoffNote) ||
      sanitizeNote(order.deliverySnapshot?.noteEs) ||
      "Pickup listo.";
    const messageText = `Pedido #${order.orderNumber || ""} - ${order.businessName || ""}. Nota: ${note}. Link: ${driverLinkUrl}`;

    return ok({
      orderId: String(order._id),
      city: {
        code: String(city.code || ""),
        name: String(city.name || ""),
      },
      driverLinkUrl,
      messageText,
    });
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not build WhatsApp template.",
      err.status || 500
    );
  }
}
