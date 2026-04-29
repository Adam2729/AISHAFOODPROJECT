import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { ok, fail, readJson } from "@/lib/apiResponse";
import { assertNotInMaintenance } from "@/lib/maintenance";
import { cityCode } from "@/lib/city";
import { requireDriverCityContext } from "@/lib/driverContext";
import { DriverAudit } from "@/models/DriverAudit";
import { Order } from "@/models/Order";

type ApiError = Error & { status?: number; code?: string };

type Body = {
  action?: string;
  note?: string;
  orderId?: string;
  meta?: Record<string, unknown>;
};

function normalizeText(value: unknown, max = 280) {
  return String(value || "").trim().slice(0, max);
}

export async function POST(req: Request) {
  try {
    await assertNotInMaintenance();
    await dbConnect();

    const { driver, city } = await requireDriverCityContext(req);

    const body = await readJson<Body>(req);
    const action = normalizeText(body.action, 64).toUpperCase();
    const note = normalizeText(body.note, 280);
    const orderId = normalizeText(body.orderId, 40);
    if (!action) return fail("VALIDATION_ERROR", "action is required.", 400);

    const cityIdObj = new mongoose.Types.ObjectId(String(city._id));
    const driverIdObj = new mongoose.Types.ObjectId(String(driver._id));
    let orderObjectId: mongoose.Types.ObjectId | null = null;
    if (orderId) {
      if (!mongoose.Types.ObjectId.isValid(orderId)) {
        return fail("VALIDATION_ERROR", "Invalid orderId.", 400);
      }
      orderObjectId = new mongoose.Types.ObjectId(orderId);
      const scopedOrder = await Order.findOne({
        _id: orderObjectId,
        cityId: cityIdObj,
        "dispatch.assignedDriverId": driverIdObj,
      })
        .select("_id")
        .lean<{ _id: mongoose.Types.ObjectId } | null>();
      if (!scopedOrder) {
        return fail("OUT_OF_SCOPE_ORDER", "orderId is not assigned to this driver in selected city.", 403);
      }
    }

    const audit = await DriverAudit.create({
      cityId: cityIdObj,
      driverId: driverIdObj,
      orderId: orderObjectId,
      action,
      meta: {
        note: note || null,
        ...(body.meta && typeof body.meta === "object" ? body.meta : {}),
      },
    });

    return ok({
      cityId: String(city._id),
      cityCode: cityCode(city),
      auditId: String(audit._id),
      action,
      orderId: orderObjectId ? String(orderObjectId) : null,
    });
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not write driver audit.",
      err.status || 500
    );
  }
}
