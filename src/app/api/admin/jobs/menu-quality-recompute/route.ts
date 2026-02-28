import mongoose from "mongoose";
import { ok, fail, readJson } from "@/lib/apiResponse";
import { requireAdminKey } from "@/lib/adminAuth";
import { runMenuQualityRecomputeJob } from "@/lib/menuQualityJob";

type ApiError = Error & { status?: number; code?: string };

type RecomputeBody = {
  businessId?: string;
};

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

function toOptionalBusinessIds(businessIdRaw: unknown) {
  const businessId = String(businessIdRaw || "").trim();
  if (!businessId) return [];
  if (!mongoose.Types.ObjectId.isValid(businessId)) {
    const err = new Error("Invalid businessId.") as ApiError;
    err.status = 400;
    err.code = "VALIDATION_ERROR";
    throw err;
  }
  return [new mongoose.Types.ObjectId(businessId)];
}

export async function GET(req: Request) {
  try {
    const auth = isAuthorizedCronRequest(req);
    if (!auth.ok) return fail("UNAUTHORIZED", auth.reason, auth.status);

    const url = new URL(req.url);
    const onlyBusinessIds = toOptionalBusinessIds(url.searchParams.get("businessId"));
    const result = await runMenuQualityRecomputeJob({
      onlyBusinessIds,
    });
    return ok({
      ran: true,
      ...result,
      timestamp: new Date().toISOString(),
    });
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not recompute menu quality.",
      err.status || 500
    );
  }
}

export async function POST(req: Request) {
  try {
    requireAdminKey(req);
    const body = await readJson<RecomputeBody>(req);
    const onlyBusinessIds = toOptionalBusinessIds(body.businessId);
    const result = await runMenuQualityRecomputeJob({
      onlyBusinessIds,
    });
    return ok({
      ran: true,
      ...result,
      timestamp: new Date().toISOString(),
    });
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not recompute menu quality.",
      err.status || 500
    );
  }
}
