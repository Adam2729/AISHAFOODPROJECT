import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { ok, fail, readJson } from "@/lib/apiResponse";
import { requireMerchantSession } from "@/lib/merchantAuth";
import { requireMerchantBusinessAvailable } from "@/lib/merchantBusiness";
import { assertNotInMaintenance } from "@/lib/maintenance";
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
  merchantDelivery?: {
    assignedAt?: Date | null;
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
      .select("_id businessId merchantDelivery.assignedAt")
      .lean<OrderLean | null>();
    if (!existing) return fail("NOT_FOUND", "Order not found.", 404);

    const setPayload: Record<string, unknown> = {
      "merchantDelivery.riderName": riderName || null,
      "merchantDelivery.riderPhone": riderPhone || null,
    };
    if (!existing.merchantDelivery?.assignedAt && (riderName || riderPhone)) {
      setPayload["merchantDelivery.assignedAt"] = new Date();
    }

    const updated = await Order.findOneAndUpdate(
      { _id: orderObjectId, businessId: businessObjectId },
      { $set: setPayload },
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
