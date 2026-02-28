import { ok, fail } from "@/lib/apiResponse";
import { requireAdminKey } from "@/lib/adminAuth";
import { dbConnect } from "@/lib/mongodb";
import { BackupRun } from "@/models/BackupRun";

type ApiError = Error & { status?: number; code?: string };

export async function GET(req: Request) {
  try {
    requireAdminKey(req);
    await dbConnect();
    const runs = await BackupRun.find({})
      .sort({ createdAt: -1 })
      .limit(20)
      .lean();
    return ok({ runs });
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not load backup runs.",
      err.status || 500
    );
  }
}
