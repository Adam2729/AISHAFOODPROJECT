import { dbConnect } from "@/lib/mongodb";
import { ok, fail } from "@/lib/apiResponse";
import { requireAdminKey } from "@/lib/adminAuth";
import { normalizePromoCode } from "@/lib/promo";
import { Promo } from "@/models/Promo";

type ApiError = Error & { status?: number; code?: string };

function parseLimit(raw: string | null) {
  const parsed = Number(raw || 30);
  if (!Number.isFinite(parsed) || parsed <= 0) return 30;
  return Math.min(100, Math.floor(parsed));
}

export async function GET(req: Request) {
  try {
    requireAdminKey(req);
    const url = new URL(req.url);
    const q = normalizePromoCode(String(url.searchParams.get("q") || ""));
    const activeOnly = ["1", "true", "yes"].includes(
      String(url.searchParams.get("activeOnly") || "").toLowerCase()
    );
    const limit = parseLimit(url.searchParams.get("limit"));

    await dbConnect();
    const query: Record<string, unknown> = {};
    if (q) query.code = { $regex: q, $options: "i" };
    if (activeOnly) query.isActive = true;

    const promos = await Promo.find(query).sort({ createdAt: -1 }).limit(limit).lean();
    return ok({ promos });
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(err.code || "SERVER_ERROR", err.message || "Could not load promos.", err.status || 500);
  }
}
