import { ok, fail } from "@/lib/apiResponse";
import { listCitiesForPublic, requireActiveCity } from "@/lib/city";
import { getMarketConfig } from "@/lib/marketConfig";

type ApiError = Error & { status?: number; code?: string };

export async function GET() {
  try {
    const cities = await listCitiesForPublic();
    const activeCities = cities.filter((city) => {
      try {
        requireActiveCity(city);
        return true;
      } catch {
        return false;
      }
    });
    return ok({
      cities: activeCities.map((city) => {
        const market = getMarketConfig(city);
        return {
          ...market,
          _id: String(city._id),
          code: String(city.code || ""),
          slug: String(city.slug || ""),
          name: String(city.name || ""),
          country: String(city.country || ""),
          currency: market.currencyCode,
          cityCurrency: String(city.currency || ""),
        };
      }),
    });
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not list cities.",
      err.status || 500
    );
  }
}
