/* eslint-disable @typescript-eslint/no-explicit-any */
import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { ok, fail, readJson } from "@/lib/apiResponse";
import { BASE_LOCATION, MAX_RADIUS_KM } from "@/lib/constants";
import { isWithinRadiusKm } from "@/lib/geo";
import { roundCurrency } from "@/lib/money";
import { assertNotInMaintenance } from "@/lib/maintenance";
import { normalizePhone, phoneToHash } from "@/lib/phoneHash";
import { computeSubscriptionStatus } from "@/lib/subscription";
import { runSubscriptionStatusJob } from "@/lib/subscriptionJob";
import { Business } from "@/models/Business";
import { Order } from "@/models/Order";
import { Product } from "@/models/Product";

type ReorderBody = {
  phone?: string;
  orderId?: string;
  orderNumber?: string;
  address?: string;
  lat?: number;
  lng?: number;
};

type PreviousOrderLean = {
  _id: mongoose.Types.ObjectId;
  orderNumber: string;
  businessId: mongoose.Types.ObjectId;
  businessName: string;
  phone?: string;
  items: Array<{
    productId: mongoose.Types.ObjectId;
    name: string;
    qty: number;
  }>;
};

function normalizeString(value: unknown) {
  return String(value || "").trim();
}

export async function POST(req: Request) {
  try {
    await assertNotInMaintenance();

    const body = await readJson<ReorderBody>(req);
    const phone = normalizeString(body.phone);
    const orderId = normalizeString(body.orderId);
    const orderNumber = normalizeString(body.orderNumber);
    if (!phone) return fail("VALIDATION_ERROR", "phone is required.", 400);
    if (!orderId && !orderNumber) {
      return fail("VALIDATION_ERROR", "orderId or orderNumber is required.", 400);
    }
    if (orderId && !mongoose.Types.ObjectId.isValid(orderId)) {
      return fail("VALIDATION_ERROR", "Invalid orderId.", 400);
    }
    if (!normalizePhone(phone)) {
      return fail("VALIDATION_ERROR", "Invalid phone.", 400);
    }

    await dbConnect();
    await runSubscriptionStatusJob();

    const phoneHash = phoneToHash(phone);
    const byHashQuery: Record<string, unknown> = { phoneHash };
    if (orderId) byHashQuery._id = new mongoose.Types.ObjectId(orderId);
    else byHashQuery.orderNumber = orderNumber;

    let previous = await Order.findOne(byHashQuery)
      .select("_id orderNumber businessId businessName phone items")
      .lean<PreviousOrderLean | null>();

    // Legacy fallback for orders created before phoneHash was stored.
    if (!previous) {
      const legacyQuery: Record<string, unknown> = { phone };
      if (orderId) legacyQuery._id = new mongoose.Types.ObjectId(orderId);
      else legacyQuery.orderNumber = orderNumber;
      previous = await Order.findOne(legacyQuery)
        .select("_id orderNumber businessId businessName phone items")
        .lean<PreviousOrderLean | null>();
    }

    if (!previous) {
      return fail("NOT_FOUND", "Order not found.", 404);
    }

    const business = await Business.findById(previous.businessId)
      .select("name isActive paused location subscription")
      .lean();
    if (!business || !business.isActive) {
      return fail("BUSINESS_NOT_AVAILABLE", "Business is not available.", 404);
    }
    if (Boolean((business as any).paused)) {
      return fail("BUSINESS_PAUSED", "Este negocio esta pausado temporalmente.", 403);
    }

    const subscription = computeSubscriptionStatus((business as any).subscription || {});
    if (subscription.status === "suspended") {
      return fail("BUSINESS_SUSPENDED", "Business is not available right now.", 403);
    }

    const businessLng = Number((business as any)?.location?.coordinates?.[0]);
    const businessLat = Number((business as any)?.location?.coordinates?.[1]);
    const withinCoverage = isWithinRadiusKm(
      BASE_LOCATION.lat,
      BASE_LOCATION.lng,
      businessLat,
      businessLng,
      MAX_RADIUS_KM
    );
    if (!withinCoverage) {
      return fail("BUSINESS_OUTSIDE_CLUSTER", "Business is outside coverage cluster.", 400);
    }

    const previousItems = Array.isArray(previous.items) ? previous.items : [];
    const productIds = previousItems
      .map((item) => String(item?.productId || ""))
      .filter((id) => mongoose.Types.ObjectId.isValid(id))
      .map((id) => new mongoose.Types.ObjectId(id));

    const products = await Product.find({
      _id: { $in: productIds },
      businessId: previous.businessId,
      isAvailable: true,
    })
      .select("_id name price isAvailable")
      .lean();
    const productMap = new Map(products.map((product: any) => [String(product._id), product]));

    const items: Array<{
      productId: string;
      name: string;
      unitPrice: number;
      qty: number;
      lineTotal: number;
    }> = [];
    const removedItems: Array<{ productId: string; name: string; reason: string }> = [];

    for (const item of previousItems) {
      const id = String(item?.productId || "");
      const live = productMap.get(id);
      if (!live) {
        removedItems.push({
          productId: id,
          name: String(item?.name || "Producto"),
          reason: "Producto no disponible actualmente.",
        });
        continue;
      }
      const qty = Math.max(1, Math.min(50, Number(item?.qty || 1)));
      const unitPrice = roundCurrency(Number(live.price || 0));
      const lineTotal = roundCurrency(unitPrice * qty);
      items.push({
        productId: id,
        name: String(live.name || item?.name || "Producto"),
        unitPrice,
        qty,
        lineTotal,
      });
    }

    const subtotal = roundCurrency(items.reduce((sum, item) => sum + Number(item.lineTotal || 0), 0));

    return ok({
      businessId: String(previous.businessId),
      businessName: String((business as any).name || previous.businessName || ""),
      businessType: String((business as any).type || ""),
      items,
      removedItems,
      subtotal,
    });
  } catch (error: unknown) {
    const err = error as Error & { status?: number; code?: string };
    const status = err.status || 500;
    return fail(err.code || "SERVER_ERROR", err.message || "Could not create reorder draft.", status);
  }
}
