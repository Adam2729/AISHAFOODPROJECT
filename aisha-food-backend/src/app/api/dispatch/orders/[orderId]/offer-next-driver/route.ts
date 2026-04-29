import mongoose from "mongoose";
import { ok, fail, readJson } from "@/lib/apiResponse";
import { requireAdminKey } from "@/lib/adminAuth";
import { resolveDispatchSelectedCity } from "@/lib/dispatchControl";
import { offerNextDriverForOrder } from "@/lib/driverDispatchOffers";
import { assertNotInMaintenance } from "@/lib/maintenance";
import { dbConnect } from "@/lib/mongodb";

type ApiError = Error & { status?: number; code?: string };

type Body = {
  cityId?: string;
  note?: string;
};

export async function POST(
  req: Request,
  context: { params: Promise<{ orderId: string }> }
) {
  try {
    requireAdminKey(req);
    await assertNotInMaintenance();
    await dbConnect();

    const { orderId } = await context.params;
    if (!mongoose.Types.ObjectId.isValid(orderId)) {
      return fail("VALIDATION_ERROR", "Valid orderId is required.", 400);
    }

    const body = await readJson<Body>(req).catch(() => ({} as Body));
    const selectedCity = await resolveDispatchSelectedCity(req, body.cityId);
    const result = await offerNextDriverForOrder({
      orderId: new mongoose.Types.ObjectId(orderId),
      cityId: new mongoose.Types.ObjectId(String(selectedCity._id)),
      actor: "admin",
      source: "dispatch.orders.offer_next_driver",
      note: String(body.note || "").trim() || null,
    });

    return ok(result);
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not offer order to the next driver.",
      err.status || 500
    );
  }
}
