import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { ok, fail, readJson } from "@/lib/apiResponse";
import { requireAdminKey } from "@/lib/adminAuth";
import { logRequest } from "@/lib/logger";
import { Settlement } from "@/models/Settlement";
import { Order } from "@/models/Order";

type ApiError = Error & { status?: number; code?: string };

type Body = {
  businessId?: string;
  weekKey?: string;
  receiptRef?: string;
};

export async function POST(req: Request) {
  const startedAt = Date.now();
  const finish = (
    response: ReturnType<typeof ok> | ReturnType<typeof fail>,
    status: number,
    extra?: Record<string, unknown>
  ) => {
    logRequest(req, {
      route: "admin.settlements.collect",
      status,
      durationMs: Date.now() - startedAt,
      extra,
    });
    return response;
  };

  try {
    requireAdminKey(req);
    const body = await readJson<Body>(req);
    const businessId = String(body.businessId || "").trim();
    const weekKey = String(body.weekKey || "").trim();
    const receiptRef = String(body.receiptRef || "").trim();
    if (!mongoose.Types.ObjectId.isValid(businessId) || !weekKey) {
      return finish(fail("VALIDATION_ERROR", "businessId and weekKey are required."), 400, {
        businessId,
        weekKey,
      });
    }

    await dbConnect();
    const collectedAt = new Date();

    const settlement = await Settlement.findOneAndUpdate(
      { businessId: new mongoose.Types.ObjectId(businessId), weekKey },
      { $set: { status: "collected", collectedAt, receiptRef } },
      { new: true }
    ).lean();
    if (!settlement) {
      return finish(fail("NOT_FOUND", "Settlement not found.", 404), 404, {
        businessId,
        weekKey,
      });
    }

    await Order.updateMany(
      { businessId: new mongoose.Types.ObjectId(businessId), "settlement.weekKey": weekKey },
      { $set: { "settlement.status": "collected", "settlement.collectedAt": collectedAt } }
    );

    return finish(ok({ settlement }), 200, {
      businessId,
      weekKey,
    });
  } catch (e: unknown) {
    const err = e as ApiError;
    return finish(
      fail(err.code || "SERVER_ERROR", err.message || "Could not collect settlement.", err.status || 500),
      err.status || 500,
      { error: err.message || "Could not collect settlement." }
    );
  }
}
