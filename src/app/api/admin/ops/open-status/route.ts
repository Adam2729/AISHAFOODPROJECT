import { dbConnect } from "@/lib/mongodb";
import { ok, fail } from "@/lib/apiResponse";
import { requireAdminKey } from "@/lib/adminAuth";
import { isBusinessOpenNow } from "@/lib/businessHours";
import { Business } from "@/models/Business";

type ApiError = Error & { status?: number; code?: string };
type OpenReason = "closed" | "busy" | "manual_pause";

export async function GET(req: Request) {
  try {
    requireAdminKey(req);
    await dbConnect();

    const businesses = await Business.find({
      isActive: true,
      isDemo: { $ne: true },
    })
      .select("name busyUntil paused isManuallyPaused hours")
      .lean();

    const counts = {
      open: 0,
      closed: 0,
      busy: 0,
      paused: 0,
    };

    const listClosedNow = businesses
      .map((business) => {
        const status = isBusinessOpenNow(business);
        if (status.open) {
          counts.open += 1;
          return null;
        }

        const reason = (status.reason || "closed") as OpenReason;
        if (reason === "busy") counts.busy += 1;
        else if (reason === "manual_pause") counts.paused += 1;
        else counts.closed += 1;

        return {
          businessId: String(business._id),
          businessName: String(business.name || "Business"),
          reason,
          nextOpenText: String(status.nextOpenText || "").trim() || null,
          busyUntil:
            business.busyUntil && !Number.isNaN(new Date(business.busyUntil).getTime())
              ? new Date(business.busyUntil).toISOString()
              : null,
        };
      })
      .filter(Boolean)
      .sort((a, b) => {
        const left = a as { reason: OpenReason; businessName: string };
        const right = b as { reason: OpenReason; businessName: string };
        const rank = (value: OpenReason) => {
          if (value === "manual_pause") return 0;
          if (value === "busy") return 1;
          return 2;
        };
        const reasonDiff = rank(left.reason) - rank(right.reason);
        if (reasonDiff !== 0) return reasonDiff;
        return left.businessName.localeCompare(right.businessName, "es");
      })
      .slice(0, 30);

    return ok({ counts, listClosedNow });
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not load open status.",
      err.status || 500
    );
  }
}
