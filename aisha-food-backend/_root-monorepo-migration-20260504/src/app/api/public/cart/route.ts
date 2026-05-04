import { ok, fail } from "@/lib/apiResponse";
import { assertNotInMaintenance } from "@/lib/maintenance";

export async function GET() {
  try {
    await assertNotInMaintenance();
    return ok({
      data: {
        items: [],
      },
    });
  } catch (error: unknown) {
    const err = error as Error & { status?: number; code?: string };
    return fail(err.code || "SERVER_ERROR", err.message || "Could not load cart.", err.status || 500);
  }
}

