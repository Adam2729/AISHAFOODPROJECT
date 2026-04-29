import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { ok, fail, readJson } from "@/lib/apiResponse";
import { requireMerchantSession } from "@/lib/merchantAuth";
import { requireMerchantBusinessAvailable } from "@/lib/merchantBusiness";
import { resolveOperationalOrderDeliveryMode } from "@/lib/deliveryPolicy";
import { assertNotInMaintenance } from "@/lib/maintenance";
import { buildOrderEvent, buildOrderEventPush } from "@/lib/orderOperations";
import { Business } from "@/models/Business";
import { BusinessAudit } from "@/models/BusinessAudit";
import { Order } from "@/models/Order";

type ApiError = Error & { status?: number; code?: string };

type AssignRiderBody = {
  riderName?: string;
  riderPhone?: string;
};

type OrderLean = {
  _id: mongoose.Types.ObjectId;
  businessId: mongoose.Types.ObjectId;
  status?: string | null;
  deliverySnapshot?: {
    mode?: string | null;
  };
  merchantDelivery?: {
    assignedAt?: Date | null;
    riderName?: string | null;
    riderPhone?: string | null;
  };
};

function maskPhone(value: string) {
  const digits = String(value || "").replace(/\D/g, "");
  if (!digits) return null;
  const tail = digits.slice(-4);
  return `***${tail}`;
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ orderId: string }> }
) {
  try {
    await assertNotInMaintenance();

    const session = requireMerchantSession(req);
    const { orderId } = await params;
    if (!mongoose.Types.ObjectId.isValid(orderId)) {
      return fail("VALIDATION_ERROR", "Invalid orderId.", 400);
    }

    const body = await readJson<AssignRiderBody>(req);
    const riderName = String(body.riderName || "").trim().slice(0, 60);
    const riderPhone = String(body.riderPhone || "").trim().slice(0, 30);

    await dbConnect();
    await requireMerchantBusinessAvailable(session.businessId);
    const businessObjectId = new mongoose.Types.ObjectId(session.businessId);
    const orderObjectId = new mongoose.Types.ObjectId(orderId);

    const existing = await Order.findOne({
      _id: orderObjectId,
      businessId: businessObjectId,
    })
      .select("_id businessId status deliverySnapshot.mode merchantDelivery.assignedAt merchantDelivery.riderName merchantDelivery.riderPhone")
      .lean<OrderLean | null>();
    if (!existing) return fail("NOT_FOUND", "Order not found.", 404);
    if (["delivered", "cancelled"].includes(String(existing.status || "").trim())) {
      return fail("INVALID_STATE", "Rider details can no longer be changed for this order.", 409);
    }
    const business = await Business.findById(businessObjectId)
      .select("_id deliveryType")
      .lean<{ _id: mongoose.Types.ObjectId; deliveryType?: string | null } | null>();
    if (resolveOperationalOrderDeliveryMode(existing, business) !== "self_delivery") {
      return fail(
        "INVALID_DELIVERY_MODEL",
        "Merchant rider assignment is only available for self-delivery businesses.",
        409
      );
    }

    const setPayload: Record<string, unknown> = {
      "merchantDelivery.riderName": riderName || null,
      "merchantDelivery.riderPhone": riderPhone || null,
    };
    if (!existing.merchantDelivery?.assignedAt && (riderName || riderPhone)) {
      setPayload["merchantDelivery.assignedAt"] = new Date();
    }

    const riderSummary = [riderName, riderPhone].filter(Boolean).join(" - ").trim();
    const updated = await Order.findOneAndUpdate(
      { _id: orderObjectId, businessId: businessObjectId },
      {
        $set: setPayload,
        ...(riderSummary
          ? buildOrderEventPush(
              buildOrderEvent({
                type: "assigned_rider",
                label: "Own driver assigned",
                detail: riderSummary,
                actor: "merchant",
              })
            )
          : {}),
      },
      { returnDocument: "after" }
    ).lean();
    if (!updated) return fail("NOT_FOUND", "Order not found.", 404);

    await BusinessAudit.create({
      businessId: businessObjectId,
      action: "RIDER_ASSIGNED",
      meta: {
        orderId: String(orderObjectId),
        riderName: riderName || null,
        riderPhoneMasked: maskPhone(riderPhone),
        assignedAt: setPayload["merchantDelivery.assignedAt"] || existing.merchantDelivery?.assignedAt || null,
      },
    });

    return ok({ order: updated });
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not assign rider.",
      err.status || 500
    );
  }
}
