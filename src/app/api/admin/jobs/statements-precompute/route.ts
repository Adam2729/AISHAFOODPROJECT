import mongoose from "mongoose";
import { ok, fail } from "@/lib/apiResponse";
import { requireAdminKey } from "@/lib/adminAuth";
import { getWeekKey } from "@/lib/geo";
import { dbConnect } from "@/lib/mongodb";
import { ensureStatementArchive } from "@/lib/statementArchive";
import { logRequest } from "@/lib/logger";
import { Order } from "@/models/Order";
import { Business } from "@/models/Business";

type ApiError = Error & { status?: number; code?: string };

const MAX_BUSINESSES_PER_RUN = 50;

function isAuthorizedCronRequest(req: Request) {
  const secret = String(process.env.CRON_SECRET || "").trim();
  if (!secret) return { ok: false, reason: "CRON_SECRET is missing in env.", status: 500 };

  const authHeader = String(req.headers.get("authorization") || "").trim();
  const bearer = authHeader.toLowerCase().startsWith("bearer ") ? authHeader.slice(7).trim() : "";
  const headerSecret = String(req.headers.get("x-cron-secret") || "").trim();
  const token = bearer || headerSecret;
  if (!token || token !== secret) {
    return { ok: false, reason: "Unauthorized cron request.", status: 401 };
  }
  return { ok: true, reason: "", status: 200 };
}

function previousWeekKey(dateInput = new Date()) {
  const previous = new Date(dateInput);
  previous.setUTCDate(previous.getUTCDate() - 7);
  return getWeekKey(previous);
}

async function runPrecompute(weekKeys: string[]) {
  await dbConnect();
  const normalizedWeekKeys = Array.from(new Set(weekKeys.map((wk) => String(wk || "").trim()).filter(Boolean)));
  if (!normalizedWeekKeys.length) {
    return {
      ran: true,
      weekKeys: [],
      scannedBusinesses: 0,
      pairsConsidered: 0,
      archivesCreated: 0,
      archivesReused: 0,
      limitApplied: MAX_BUSINESSES_PER_RUN,
      timestamp: new Date().toISOString(),
    };
  }

  const grouped = await Order.aggregate<{
    _id: { businessId: mongoose.Types.ObjectId; weekKey: string };
    deliveredCount: number;
  }>([
    {
      $match: {
        status: "delivered",
        "settlement.counted": true,
        "settlement.weekKey": { $in: normalizedWeekKeys },
      },
    },
    {
      $group: {
        _id: {
          businessId: "$businessId",
          weekKey: "$settlement.weekKey",
        },
        deliveredCount: { $sum: 1 },
      },
    },
    { $match: { deliveredCount: { $gt: 0 } } },
    { $sort: { deliveredCount: -1 } },
    { $limit: 1000 },
  ]);

  const businessIds = Array.from(
    new Set(grouped.map((row) => String(row._id.businessId)).filter((id) => mongoose.Types.ObjectId.isValid(id)))
  )
    .slice(0, MAX_BUSINESSES_PER_RUN)
    .map((id) => new mongoose.Types.ObjectId(id));

  const activeBusinesses = await Business.find({
    _id: { $in: businessIds },
    isActive: true,
    isDemo: { $ne: true },
  })
    .select("_id")
    .lean<{ _id: mongoose.Types.ObjectId }[]>();

  const activeBusinessIdSet = new Set(activeBusinesses.map((row) => String(row._id)));
  const pairs = grouped.filter((row) => activeBusinessIdSet.has(String(row._id.businessId)));

  let archivesCreated = 0;
  let archivesReused = 0;
  for (const pair of pairs) {
    const result = await ensureStatementArchive({
      businessId: String(pair._id.businessId),
      weekKey: String(pair._id.weekKey || ""),
      generatedBy: "cron",
      forceNewVersion: false,
    });
    if (result.created) archivesCreated += 1;
    else archivesReused += 1;
  }

  return {
    ran: true,
    weekKeys: normalizedWeekKeys,
    scannedBusinesses: activeBusinessIdSet.size,
    pairsConsidered: pairs.length,
    archivesCreated,
    archivesReused,
    limitApplied: MAX_BUSINESSES_PER_RUN,
    timestamp: new Date().toISOString(),
  };
}

export async function GET(req: Request) {
  const startedAt = Date.now();
  try {
    const auth = isAuthorizedCronRequest(req);
    if (!auth.ok) return fail("UNAUTHORIZED", auth.reason, auth.status);

    const url = new URL(req.url);
    const weekKey = String(url.searchParams.get("weekKey") || "").trim();
    const weekKeys = weekKey ? [weekKey] : [getWeekKey(new Date()), previousWeekKey(new Date())];
    const payload = await runPrecompute(weekKeys);
    logRequest(req, {
      route: "admin.jobs.statements-precompute",
      status: 200,
      durationMs: Date.now() - startedAt,
      extra: {
        weekKeys: payload.weekKeys,
        created: payload.archivesCreated,
        reused: payload.archivesReused,
      },
    });
    return ok(payload);
  } catch (error: unknown) {
    const err = error as ApiError;
    const status = err.status || 500;
    logRequest(req, {
      route: "admin.jobs.statements-precompute",
      status,
      durationMs: Date.now() - startedAt,
      extra: { message: err.message || "Could not run statements precompute job." },
    });
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not run statements precompute job.",
      status
    );
  }
}

export async function POST(req: Request) {
  const startedAt = Date.now();
  try {
    requireAdminKey(req);
    const url = new URL(req.url);
    const weekKey = String(url.searchParams.get("weekKey") || "").trim();
    const weekKeys = weekKey ? [weekKey] : [getWeekKey(new Date()), previousWeekKey(new Date())];
    const payload = await runPrecompute(weekKeys);
    logRequest(req, {
      route: "admin.jobs.statements-precompute",
      status: 200,
      durationMs: Date.now() - startedAt,
      extra: {
        weekKeys: payload.weekKeys,
        created: payload.archivesCreated,
        reused: payload.archivesReused,
      },
    });
    return ok(payload);
  } catch (error: unknown) {
    const err = error as ApiError;
    const status = err.status || 500;
    logRequest(req, {
      route: "admin.jobs.statements-precompute",
      status,
      durationMs: Date.now() - startedAt,
      extra: { message: err.message || "Could not run statements precompute job." },
    });
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not run statements precompute job.",
      status
    );
  }
}
