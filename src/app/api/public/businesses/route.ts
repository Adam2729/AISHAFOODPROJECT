/* eslint-disable @typescript-eslint/no-explicit-any */
import { dbConnect } from "@/lib/mongodb";
import { ok, fail } from "@/lib/apiResponse";
import { BASE_LOCATION, MAX_RADIUS_KM } from "@/lib/constants";
import { haversineDistanceKm, isWithinRadiusKm } from "@/lib/geo";
import { computeSubscriptionStatus } from "@/lib/subscription";
import { runSubscriptionStatusJob } from "@/lib/subscriptionJob";
import { Business } from "@/models/Business";

function parseCoord(value: string | null) {
  if (!value) return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return n;
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const lat = parseCoord(url.searchParams.get("lat"));
    const lng = parseCoord(url.searchParams.get("lng"));
    if ((lat === null) !== (lng === null)) {
      return fail("INVALID_COORDS", "Provide both lat and lng or omit both.");
    }

    await dbConnect();
    await runSubscriptionStatusJob();
    const rawBusinesses = await Business.find({ isActive: true })
      .select("name phone whatsapp address logoUrl location type isActive subscription")
      .sort({ createdAt: -1 })
      .lean();

    const businesses = rawBusinesses
      .map((b: any) => {
        const bLng = Number(b?.location?.coordinates?.[0]);
        const bLat = Number(b?.location?.coordinates?.[1]);
        if (!Number.isFinite(bLat) || !Number.isFinite(bLng)) return null;

        const withinBase = isWithinRadiusKm(BASE_LOCATION.lat, BASE_LOCATION.lng, bLat, bLng, MAX_RADIUS_KM);
        if (!withinBase) return null;

        const subscription = computeSubscriptionStatus(b.subscription || {});
        if (subscription.status === "suspended") return null;

        const distanceKm =
          lat !== null && lng !== null ? haversineDistanceKm(lat, lng, bLat, bLng) : null;

        return {
          id: String(b._id),
          type: b.type,
          name: b.name,
          phone: b.phone,
          whatsapp: b.whatsapp,
          address: b.address,
          logoUrl: b.logoUrl || "",
          distanceKm,
          freeDeliveryBadge: "Free delivery (paid by business)",
          subscriptionStatus: subscription.status,
        };
      })
      .filter(Boolean) as Array<Record<string, unknown>>;

    if (lat !== null && lng !== null) {
      businesses.sort((a, b) => Number(a.distanceKm ?? 0) - Number(b.distanceKm ?? 0));
    }

    const userWithinCoverage =
      lat !== null && lng !== null
        ? isWithinRadiusKm(BASE_LOCATION.lat, BASE_LOCATION.lng, lat, lng, MAX_RADIUS_KM)
        : true;

    return ok({
      businesses,
      coverage: {
        maxRadiusKm: MAX_RADIUS_KM,
        userWithinCoverage,
        message: userWithinCoverage
          ? "Estas dentro del area de cobertura."
          : "Estas fuera del area de cobertura (8km). Solo puedes explorar por ahora.",
      },
    });
  } catch {
    return fail("SERVER_ERROR", "Could not load businesses.", 500);
  }
}
