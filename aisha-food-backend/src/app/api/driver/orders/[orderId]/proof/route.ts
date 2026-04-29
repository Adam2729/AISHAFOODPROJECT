import mongoose from "mongoose";
import { ok, fail, readJson } from "@/lib/apiResponse";
import { requireDriverCityContext } from "@/lib/driverContext";
import { assertNotInMaintenance } from "@/lib/maintenance";
import { dbConnect } from "@/lib/mongodb";
import { DriverAudit } from "@/models/DriverAudit";
import { Order } from "@/models/Order";

type ApiError = Error & { status?: number; code?: string };

type Body = {
  note?: string;
  photoUrl?: string;
};

const PROOF_EDITABLE_STATUSES = ["accepted", "preparing", "ready", "out_for_delivery"];

function cleanText(value: unknown, max: number) {
  return String(value || "").trim().slice(0, max);
}

function serializeProof(proof?: {
  required?: boolean;
  otpLast4?: string | null;
  verifiedAt?: Date | null;
  note?: string | null;
  photoUrl?: string | null;
  capturedAt?: Date | null;
  capturedByDriverId?: mongoose.Types.ObjectId | null;
} | null) {
  return {
    required: proof?.required !== false,
    otpLast4: String(proof?.otpLast4 || "").trim() || null,
    verifiedAt: proof?.verifiedAt || null,
    note: String(proof?.note || "").trim() || null,
    photoUrl: String(proof?.photoUrl || "").trim() || null,
    capturedAt: proof?.capturedAt || null,
    capturedByDriverId: proof?.capturedByDriverId ? String(proof.capturedByDriverId) : null,
  };
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
    const note = cleanText(body.note, 280);
    const photoUrl = cleanText(body.photoUrl, 500);
    if (!note && !photoUrl) {
      return fail("VALIDATION_ERROR", "note or photoUrl is required.", 400);
    }

    const cityIdObj = new mongoose.Types.ObjectId(String(city._id));
    const driverIdObj = new mongoose.Types.ObjectId(String(driver._id));
    const orderObjectId = new mongoose.Types.ObjectId(orderId);
    const capturedAt = new Date();

    const updated = await Order.findOneAndUpdate(
      {
        _id: orderObjectId,
        cityId: cityIdObj,
        "deliverySnapshot.mode": "platform_driver",
        "dispatch.assignedDriverId": driverIdObj,
        status: { $in: PROOF_EDITABLE_STATUSES },
      },
      {
        $set: {
          "deliveryProof.note": note || null,
          "deliveryProof.photoUrl": photoUrl || null,
          "deliveryProof.capturedAt": capturedAt,
          "deliveryProof.capturedByDriverId": driverIdObj,
        },
      },
      { new: true }
    )
      .select(
        "_id deliveryProof.required deliveryProof.otpLast4 deliveryProof.verifiedAt deliveryProof.note deliveryProof.photoUrl deliveryProof.capturedAt deliveryProof.capturedByDriverId"
      )
      .lean<{
        _id: mongoose.Types.ObjectId;
        deliveryProof?: {
          required?: boolean;
          otpLast4?: string | null;
          verifiedAt?: Date | null;
          note?: string | null;
          photoUrl?: string | null;
          capturedAt?: Date | null;
          capturedByDriverId?: mongoose.Types.ObjectId | null;
        };
      } | null>();

    if (!updated) {
      const existing = await Order.findById(orderObjectId)
        .select("_id cityId deliverySnapshot.mode dispatch.assignedDriverId status")
        .lean<{
          _id: mongoose.Types.ObjectId;
          cityId?: mongoose.Types.ObjectId | null;
          deliverySnapshot?: { mode?: string | null };
          dispatch?: { assignedDriverId?: mongoose.Types.ObjectId | null };
          status?: string;
        } | null>();

      if (!existing || String(existing.cityId || "") !== String(city._id)) {
        return fail("NOT_FOUND", "Order not found in selected city.", 404);
      }
      if (String(existing.deliverySnapshot?.mode || "") !== "platform_driver") {
        return fail("INVALID_DELIVERY_MODEL", "Only platform-driver orders can accept driver proof.", 409);
      }
      if (String(existing.dispatch?.assignedDriverId || "") !== String(driver._id)) {
        return fail("FORBIDDEN", "Only the assigned driver can submit delivery proof.", 403);
      }
      if (existing.status === "cancelled" || existing.status === "delivered") {
        return fail("STATUS_NOT_ALLOWED", "Cannot update proof for final orders.", 409);
      }
      return fail("STATUS_NOT_ALLOWED", "Cannot update proof in the current order status.", 409);
    }

    await DriverAudit.create({
      cityId: cityIdObj,
      driverId: driverIdObj,
      orderId: orderObjectId,
      action: "DELIVERY_PROOF_CAPTURED",
      meta: {
        hasNote: Boolean(note),
        hasPhoto: Boolean(photoUrl),
      },
    });

    return ok({
      orderId: String(updated._id),
      deliveryProof: serializeProof(updated.deliveryProof),
    });
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not save delivery proof.",
      err.status || 500
    );
  }
}
