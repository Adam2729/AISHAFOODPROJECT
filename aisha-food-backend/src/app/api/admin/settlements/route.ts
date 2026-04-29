import { dbConnect } from "@/lib/mongodb";
import { ok, fail } from "@/lib/apiResponse";
import { requireAdminKey } from "@/lib/adminAuth";
import { getWeekKey } from "@/lib/geo";
import { Settlement } from "@/models/Settlement";

type ApiError = Error & { status?: number; code?: string };

export async function GET(req: Request) {
  try {
    requireAdminKey(req);
    const weekKey = new URL(req.url).searchParams.get("weekKey")?.trim() || getWeekKey(new Date());

    await dbConnect();
    const settlements = await Settlement.find({ weekKey }).sort({ feeTotal: -1 }).lean();

    return ok({
      weekKey,
      settlements,
    });
  } catch (e: unknown) {
    const err = e as ApiError;
    return fail(err.code || "SERVER_ERROR", err.message || "Could not load settlements.", err.status || 500);
  }
}
