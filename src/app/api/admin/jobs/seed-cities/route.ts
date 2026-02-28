import { ok, fail } from "@/lib/apiResponse";
import { requireAdminKey } from "@/lib/adminAuth";
import { seedCities } from "@/lib/city";

type ApiError = Error & { status?: number; code?: string };

export async function POST(req: Request) {
  try {
    requireAdminKey(req);
    const result = await seedCities();
    return ok({
      seeded: true,
      ...result,
    });
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not seed cities.",
      err.status || 500
    );
  }
}

export async function GET(req: Request) {
  return POST(req);
}
