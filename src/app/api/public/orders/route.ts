/* eslint-disable @typescript-eslint/no-explicit-any */
import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { ok, fail, readJson } from "@/lib/apiResponse";
import { BASE_LOCATION, COMMISSION_RATE_DEFAULT, MAX_RADIUS_KM } from "@/lib/constants";
import { getWeekKey, isWithinRadiusKm } from "@/lib/geo";
import { roundCurrency } from "@/lib/money";
import { computeSubscriptionStatus } from "@/lib/subscription";
import { geocodeAddress, isValidLatLng } from "@/lib/googleMaps";
import { generateUniqueOrderNumber, isDuplicateKeyError } from "@/lib/orderNumber";
import { runSubscriptionStatusJob } from "@/lib/subscriptionJob";
import { logRequest, maskIp, maskPhone } from "@/lib/logger";
import { assertNotInMaintenance } from "@/lib/maintenance";
import { assertPilotAllowed } from "@/lib/pilot";
import { consumeRateLimit } from "@/lib/requestRateLimit";
import { Business } from "@/models/Business";
import { Product } from "@/models/Product";
import { Order } from "@/models/Order";

type OrderItemInput = {
  productId: string;
  qty: number;
};

type CreateOrderBody = {
  customerName?: string;
  phone?: string;
  address?: string;
  lat?: number;
  lng?: number;
  city?: string;
  businessId?: string;
  items?: OrderItemInput[];
};

function normalizeString(v: unknown) {
  return String(v || "").trim();
}

function getClientIp(req: Request) {
  const forwarded = String(req.headers.get("x-forwarded-for") || "").trim();
  if (forwarded) {
    return forwarded.split(",")[0].trim();
  }
  return String(req.headers.get("x-real-ip") || "").trim();
}

export async function POST(req: Request) {
  const startedAt = Date.now();
  const finish = (
    response: ReturnType<typeof ok> | ReturnType<typeof fail>,
    status: number,
    extra?: Record<string, unknown>
  ) => {
    logRequest(req, {
      route: "public.orders.create",
      status,
      durationMs: Date.now() - startedAt,
      extra,
    });
    return response;
  };

  try {
    await assertNotInMaintenance();

    const body = await readJson<CreateOrderBody>(req);
    const customerName = normalizeString(body.customerName);
    const phone = normalizeString(body.phone);
    const address = normalizeString(body.address);
    const businessId = normalizeString(body.businessId);
    const city = normalizeString(body.city) || "Santo Domingo";
    const items = Array.isArray(body.items) ? body.items : [];

    let lat = Number(body.lat);
    let lng = Number(body.lng);
    const coordsProvided = isValidLatLng(lat, lng);

    if (!customerName || !phone || !address || !businessId) {
      return finish(fail("VALIDATION_ERROR", "customerName, phone, address and businessId are required."), 400);
    }
    if (!mongoose.Types.ObjectId.isValid(businessId)) {
      return finish(fail("VALIDATION_ERROR", "Invalid businessId."), 400, { businessId });
    }
    if (!items.length) {
      return finish(fail("VALIDATION_ERROR", "At least one item is required."), 400, { businessId });
    }
    if (!items.every((it) => mongoose.Types.ObjectId.isValid(String(it.productId)) && Number(it.qty) > 0)) {
      return finish(fail("VALIDATION_ERROR", "Invalid productId/qty in items."), 400, { businessId });
    }
    await assertPilotAllowed(phone);

    const clientIp = getClientIp(req);
    const ipLimit = consumeRateLimit(`public-order-ip:${clientIp}`, 30, 5 * 60 * 1000);
    if (!ipLimit.allowed) {
      return finish(
        fail("RATE_LIMIT_IP", "Demasiadas solicitudes. Intenta de nuevo en un momento.", 429),
        429,
        { ip: maskIp(clientIp) }
      );
    }

    if (!coordsProvided) {
      const geo = await geocodeAddress(address, city);
      if (!geo) {
        return finish(fail("GEOCODE_FAILED", "No pudimos ubicar tu direccion."), 400, { businessId });
      }
      lat = geo.lat;
      lng = geo.lng;
    }

    const withinCoverage = isWithinRadiusKm(BASE_LOCATION.lat, BASE_LOCATION.lng, lat, lng, MAX_RADIUS_KM);
    if (!withinCoverage) {
      return finish(fail(
        "OUTSIDE_COVERAGE",
        `Lo sentimos, solo operamos dentro de ${MAX_RADIUS_KM}km del punto base.`,
        400
      ), 400, { businessId });
    }

    await dbConnect();
    await runSubscriptionStatusJob();

    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    const recentByPhone = await Order.countDocuments({
      phone,
      createdAt: { $gte: fiveMinutesAgo },
    });
    if (recentByPhone >= 5) {
      return finish(
        fail("RATE_LIMIT_PHONE", "Demasiados pedidos desde este telefono. Espera unos minutos.", 429),
        429,
        { phone: maskPhone(phone) }
      );
    }

    const business = await Business.findById(businessId).lean();
    if (!business || !(business as any).isActive) {
      return finish(fail("BUSINESS_NOT_AVAILABLE", "Business is not available.", 404), 404, { businessId });
    }
    if (Boolean((business as any).paused)) {
      return finish(
        fail("BUSINESS_PAUSED", "Este negocio esta pausado temporalmente.", 403),
        403,
        { businessId }
      );
    }
    const subscription = computeSubscriptionStatus((business as any).subscription || {});
    if (subscription.status === "suspended") {
      return finish(fail("BUSINESS_SUSPENDED", "This business is temporarily suspended.", 403), 403, {
        businessId,
      });
    }
    const bLat = Number((business as any)?.location?.coordinates?.[1]);
    const bLng = Number((business as any)?.location?.coordinates?.[0]);
    if (!isWithinRadiusKm(BASE_LOCATION.lat, BASE_LOCATION.lng, bLat, bLng, MAX_RADIUS_KM)) {
      return finish(fail("BUSINESS_OUTSIDE_CLUSTER", "Business is outside coverage cluster.", 400), 400, {
        businessId,
      });
    }

    const productIds = items.map((it) => new mongoose.Types.ObjectId(String(it.productId)));
    const products = await Product.find({
      _id: { $in: productIds },
      businessId,
      isAvailable: true,
    }).lean();
    const productMap = new Map(products.map((p: any) => [String(p._id), p]));

    if (productMap.size !== items.length) {
      return finish(fail("PRODUCTS_INVALID", "One or more products are unavailable.", 400), 400, {
        businessId,
      });
    }

    const orderItems = items.map((it) => {
      const p: any = productMap.get(String(it.productId));
      const qty = Math.max(1, Math.min(50, Number(it.qty)));
      const unitPrice = Number(p.price);
      const lineTotal = roundCurrency(unitPrice * qty);
      return {
        productId: p._id,
        name: p.name,
        productPrice: unitPrice,
        qty,
        unitPrice,
        lineTotal,
      };
    });

    const subtotal = roundCurrency(orderItems.reduce((sum, line) => sum + line.lineTotal, 0));
    const commissionRate = Number((business as any).commissionRate || COMMISSION_RATE_DEFAULT);
    const commissionAmount = roundCurrency(subtotal * commissionRate);
    const total = subtotal; // delivery is free to customer
    const weekKey = getWeekKey(new Date());

    let created: any | null = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      const orderNumber = await generateUniqueOrderNumber();
      try {
        created = await Order.create({
          orderNumber,
          businessId: (business as any)._id,
          businessName: (business as any).name,
          businessType: (business as any).type,
          customerName,
          phone,
          address,
          customerLocation: { lat, lng },
          items: orderItems,
          subtotal,
          deliveryFeeToCustomer: 0,
          total,
          commissionRate,
          commissionAmount,
          payment: { method: "cash", status: "unpaid" },
          paymentStatus: "unpaid",
          status: "new",
          settlement: { weekKey, status: "pending", counted: false },
        });
        break;
      } catch (error: unknown) {
        if (isDuplicateKeyError(error) && attempt < 4) {
          continue;
        }
        throw error;
      }
    }

    if (!created) {
      return finish(fail("ORDER_NUMBER_CONFLICT", "Could not create order number. Please retry.", 500), 500, {
        businessId,
      });
    }

    return finish(ok(
      {
        orderNumber: created.orderNumber,
        status: created.status,
        payment: { method: "cash", status: "unpaid" },
        contact: {
          whatsapp: String((business as any).whatsapp || ""),
          phone: String((business as any).phone || ""),
          businessName: String((business as any).name || ""),
        },
        totals: {
          subtotal,
          deliveryFeeToCustomer: 0,
          total,
          commissionAmount,
        },
      },
      201
    ), 201, {
      businessId,
      orderNumber: created.orderNumber,
    });
  } catch (error: unknown) {
    const err = error as Error & { status?: number; code?: string };
    const status = err.status || 500;
    return finish(fail(err.code || "SERVER_ERROR", err.message || "Could not create order.", status), status, {
      error: err.message || "Could not create order.",
    });
  }
}
