import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { ok, fail } from "@/lib/apiResponse";
import { requireMerchantSession } from "@/lib/merchantAuth";
import { requireMerchantBusinessAvailable } from "@/lib/merchantBusiness";
import { getMerchantDeliveryUi } from "@/lib/deliveryStatusPresentation";
import { Order } from "@/models/Order";
import { Business } from "@/models/Business";

type ApiError = Error & { status?: number; code?: string };

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const session = requireMerchantSession(req);
    if (!mongoose.Types.ObjectId.isValid(session.businessId)) {
      return fail("UNAUTHORIZED", "Invalid merchant session.", 401);
    }

    const url = new URL(req.url);
    const status = url.searchParams.get("status")?.trim() || "";

    await dbConnect();
    await requireMerchantBusinessAvailable(session.businessId);
    const business = await Business.findById(new mongoose.Types.ObjectId(session.businessId))
      .select("deliveryType")
      .lean<{ deliveryType?: string | null } | null>();
    const filter: Record<string, unknown> = { businessId: new mongoose.Types.ObjectId(session.businessId) };
    if (status) {
      filter.status = status;
    } else {
      filter.status = { $ne: "pending_payment" };
    }

    const orders = await Order.find(filter).sort({ createdAt: -1 }).lean();
    const nowMs = Date.now();
    const mapped = orders.map((order) => {
      const createdAt = new Date((order as { createdAt?: Date | string }).createdAt || "");
      const createdMs = createdAt.getTime();
      const acceptedAtRaw = (order as { statusTimestamps?: { acceptedAt?: Date | string | null } })
        .statusTimestamps?.acceptedAt;
      const acceptedAt = acceptedAtRaw ? new Date(acceptedAtRaw) : null;
      const acceptedMs = acceptedAt?.getTime() ?? null;
      const acceptanceDelayMinutes =
        Number.isNaN(createdMs)
          ? null
          : Number.isFinite(Number(acceptedMs))
          ? Math.max(0, Math.round((Number(acceptedMs) - createdMs) / 60000))
          : (order as { status?: string }).status === "new"
          ? Math.max(0, Math.round((nowMs - createdMs) / 60000))
          : null;

      const deliveryUi = getMerchantDeliveryUi(order, business);

      return {
        ...order,
        deliveryMode: deliveryUi.deliveryMode,
        deliveryUi,
        acceptedAt: acceptedAtRaw || null,
        acceptanceDelayMinutes,
      };
    });
    return ok({ orders: mapped });
  } catch (e: unknown) {
    const err = e as ApiError;
    return fail(err.code || "SERVER_ERROR", err.message || "Could not load merchant orders.", err.status || 500);
  }
}
