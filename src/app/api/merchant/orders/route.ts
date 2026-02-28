import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { ok, fail } from "@/lib/apiResponse";
import { requireMerchantSession } from "@/lib/merchantAuth";
import { requireMerchantBusinessAvailable } from "@/lib/merchantBusiness";
import { Order } from "@/models/Order";

type ApiError = Error & { status?: number; code?: string };

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
    const filter: Record<string, unknown> = { businessId: new mongoose.Types.ObjectId(session.businessId) };
    if (status) filter.status = status;

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

      return {
        ...order,
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
