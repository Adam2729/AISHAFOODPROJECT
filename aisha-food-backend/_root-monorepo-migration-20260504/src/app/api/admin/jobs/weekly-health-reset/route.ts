import { dbConnect } from "@/lib/mongodb";
import { ok, fail } from "@/lib/apiResponse";
import { requireAdminKey } from "@/lib/adminAuth";
import { Business } from "@/models/Business";

type ApiError = Error & { status?: number; code?: string };

function getStartOfIsoWeek(now = new Date()) {
  const utc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const day = utc.getUTCDay() || 7; // Monday=1 ... Sunday=7
  utc.setUTCDate(utc.getUTCDate() - day + 1);
  utc.setUTCHours(0, 0, 0, 0);
  return utc;
}

async function runWeeklyHealthResetJob() {
  await dbConnect();

  const now = new Date();
  const startOfWeek = getStartOfIsoWeek(now);

  const update = await Business.updateMany(
    {
      $or: [
        { "health.lastHealthResetAt": { $exists: false } },
        { "health.lastHealthResetAt": null },
        { "health.lastHealthResetAt": { $lt: startOfWeek } },
      ],
    },
    {
      $set: {
        "health.cancelsCount30d": 0,
        "health.slowAcceptCount30d": 0,
        "health.lastHealthResetAt": now,
        "health.lastHealthUpdateAt": now,
      },
    }
  );

  return {
    now,
    startOfWeek,
    matchedCount: update.matchedCount,
    modifiedCount: update.modifiedCount,
  };
}

function isAuthorizedCronRequest(req: Request) {
  const secret = String(process.env.CRON_SECRET || "").trim();
  if (!secret) return { ok: false, reason: "CRON_SECRET is missing in env." };

  const authHeader = String(req.headers.get("authorization") || "").trim();
  const bearer = authHeader.toLowerCase().startsWith("bearer ") ? authHeader.slice(7).trim() : "";
  const headerSecret = String(req.headers.get("x-cron-secret") || "").trim();
  const token = bearer || headerSecret;
  if (!token || token !== secret) {
    return { ok: false, reason: "Unauthorized cron request." };
  }

  return { ok: true, reason: "" };
}

export async function GET(req: Request) {
  try {
    const auth = isAuthorizedCronRequest(req);
    if (!auth.ok) {
      return fail("UNAUTHORIZED", auth.reason, auth.reason.includes("missing") ? 500 : 401);
    }

    const result = await runWeeklyHealthResetJob();
    return ok({
      ran: true,
      resetCount: result.modifiedCount,
      timestamp: result.now.toISOString(),
      startOfWeek: result.startOfWeek.toISOString(),
      matchedCount: result.matchedCount,
      modifiedCount: result.modifiedCount,
    });
  } catch (e: unknown) {
    const err = e as ApiError;
    return fail(err.code || "SERVER_ERROR", err.message || "Could not run weekly health reset.", err.status || 500);
  }
}

export async function POST(req: Request) {
  try {
    requireAdminKey(req);
    const result = await runWeeklyHealthResetJob();
    return ok({
      startOfWeek: result.startOfWeek.toISOString(),
      matchedCount: result.matchedCount,
      modifiedCount: result.modifiedCount,
    });
  } catch (e: unknown) {
    const err = e as ApiError;
    return fail(err.code || "SERVER_ERROR", err.message || "Could not run weekly health reset.", err.status || 500);
  }
}
