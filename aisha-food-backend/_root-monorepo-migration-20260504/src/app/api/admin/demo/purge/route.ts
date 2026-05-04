import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { ok, fail, readJson } from "@/lib/apiResponse";
import { requireAdminKey } from "@/lib/adminAuth";
import { Business } from "@/models/Business";
import { Order } from "@/models/Order";
import { Settlement } from "@/models/Settlement";
import { SettlementAudit } from "@/models/SettlementAudit";
import { BusinessAudit } from "@/models/BusinessAudit";

type ApiError = Error & { status?: number; code?: string };

type PurgeBody = {
  confirm?: string;
  businessId?: string;
};

export async function POST(req: Request) {
  try {
    requireAdminKey(req);
    const body = await readJson<PurgeBody>(req);
    const confirm = String(body.confirm || "").trim();
    const requestedBusinessId = String(body.businessId || "").trim();

    if (confirm !== "PURGE_DEMO") {
      return fail("VALIDATION_ERROR", "confirm must be PURGE_DEMO.", 400);
    }
    if (requestedBusinessId && !mongoose.Types.ObjectId.isValid(requestedBusinessId)) {
      return fail("VALIDATION_ERROR", "Invalid businessId.", 400);
    }

    await dbConnect();

    let businessIds: mongoose.Types.ObjectId[] = [];
    if (requestedBusinessId) {
      const demoBusiness = await Business.findOne({
        _id: new mongoose.Types.ObjectId(requestedBusinessId),
        isDemo: true,
      })
        .select("_id")
        .lean();
      if (!demoBusiness) {
        return fail("NOT_FOUND", "Demo business not found.", 404);
      }
      businessIds = [new mongoose.Types.ObjectId(requestedBusinessId)];
    } else {
      const demoBusinesses = await Business.find({ isDemo: true }).select("_id").lean();
      businessIds = demoBusinesses.map((b) => new mongoose.Types.ObjectId(String(b._id)));
    }

    if (!businessIds.length) {
      return ok({
        purged: true,
        businessCount: 0,
        deleted: {
          orders: 0,
          settlements: 0,
          settlementAudits: 0,
          businessAudits: 0,
        },
      });
    }

    const [orders, settlements, settlementAudits, businessAudits] = await Promise.all([
      Order.deleteMany({ businessId: { $in: businessIds } }),
      Settlement.deleteMany({ businessId: { $in: businessIds } }),
      SettlementAudit.deleteMany({ businessId: { $in: businessIds } }),
      BusinessAudit.deleteMany({ businessId: { $in: businessIds } }),
    ]);

    return ok({
      purged: true,
      businessCount: businessIds.length,
      deleted: {
        orders: orders.deletedCount || 0,
        settlements: settlements.deletedCount || 0,
        settlementAudits: settlementAudits.deletedCount || 0,
        businessAudits: businessAudits.deletedCount || 0,
      },
    });
  } catch (e: unknown) {
    const err = e as ApiError;
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not purge demo data.",
      err.status || 500
    );
  }
}
