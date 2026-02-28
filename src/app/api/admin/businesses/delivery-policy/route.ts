import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { ok, fail, readJson } from "@/lib/apiResponse";
import { requireAdminKey } from "@/lib/adminAuth";
import { getMerchantDeliveryInfo } from "@/lib/deliveryPolicy";
import { Business } from "@/models/Business";
import { BusinessAudit } from "@/models/BusinessAudit";

type ApiError = Error & { status?: number; code?: string };

type UpdateDeliveryPolicyBody = {
  businessId?: string;
  mode?: string;
  courierName?: string;
  courierPhone?: string;
  publicNoteEs?: string;
  instructionsEs?: string;
};

export async function PATCH(req: Request) {
  try {
    requireAdminKey(req);
    const body = await readJson<UpdateDeliveryPolicyBody>(req);
    const businessId = String(body.businessId || "").trim();
    const mode = String(body.mode || "").trim();
    const courierName = String(body.courierName || "").trim().slice(0, 60);
    const courierPhone = String(body.courierPhone || "").trim().slice(0, 30);
    const publicNoteEs = String(body.publicNoteEs || "").trim().slice(0, 120);
    const instructionsEs = String(body.instructionsEs || "").trim().slice(0, 280);

    if (!mongoose.Types.ObjectId.isValid(businessId)) {
      return fail("VALIDATION_ERROR", "Invalid businessId.", 400);
    }
    if (mode !== "self_delivery") {
      return fail("VALIDATION_ERROR", "mode must be self_delivery.", 400);
    }

    await dbConnect();
    const businessObjectId = new mongoose.Types.ObjectId(businessId);
    const existing = await Business.findById(businessObjectId).lean();
    if (!existing) return fail("NOT_FOUND", "Business not found.", 404);

    const before = getMerchantDeliveryInfo(existing as { deliveryPolicy?: Record<string, unknown> });

    const updated = await Business.findByIdAndUpdate(
      businessObjectId,
      {
        $set: {
          "deliveryPolicy.mode": "self_delivery",
          "deliveryPolicy.courierName": courierName,
          "deliveryPolicy.courierPhone": courierPhone,
          "deliveryPolicy.publicNoteEs": publicNoteEs,
          "deliveryPolicy.instructionsEs": instructionsEs,
          "deliveryPolicy.updatedAt": new Date(),
        },
      },
      { returnDocument: "after" }
    ).lean();
    if (!updated) return fail("NOT_FOUND", "Business not found.", 404);

    const after = getMerchantDeliveryInfo(updated as { deliveryPolicy?: Record<string, unknown> });

    await BusinessAudit.create({
      businessId: businessObjectId,
      action: "DELIVERY_POLICY_UPDATED",
      meta: {
        before,
        after,
      },
    });

    return ok({
      businessId,
      deliveryPolicy: after,
    });
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not update delivery policy.",
      err.status || 500
    );
  }
}
