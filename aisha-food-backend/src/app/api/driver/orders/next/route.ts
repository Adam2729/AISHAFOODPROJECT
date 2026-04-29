import { ok, fail } from "@/lib/apiResponse";
import { GET as listDriverOrders } from "@/app/api/driver/orders/route";

type ApiError = Error & { status?: number; code?: string };

export async function GET(req: Request) {
  try {
    const delegated = await listDriverOrders(new Request(req.url, {
      method: "GET",
      headers: req.headers,
    }));
    const payload = await delegated.clone().json().catch(() => null);
    if (!delegated.ok || !payload?.ok) {
      return delegated;
    }

    const nextOrder = payload?.data?.currentOffer || payload?.data?.activeOrder || null;

    return ok({
      driver: payload?.data?.driver || null,
      city: payload?.data?.city || null,
      order: nextOrder,
    });
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not load next driver order.",
      err.status || 500
    );
  }
}
