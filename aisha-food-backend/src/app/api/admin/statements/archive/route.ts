import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { ok, fail, readJson } from "@/lib/apiResponse";
import { requireAdminKey } from "@/lib/adminAuth";
import { logRequest } from "@/lib/logger";
import {
  createStatementDownloadLink,
  ensureStatementArchive,
  ensureStatementArchivePdf,
  getLatestStatementArchive,
} from "@/lib/statementArchive";
import { StatementArchive } from "@/models/StatementArchive";

type ApiError = Error & { status?: number; code?: string };

type Body = {
  businessId?: unknown;
  weekKey?: unknown;
  lock?: unknown;
  forceNewVersion?: unknown;
  generatedBy?: unknown;
  ttlSeconds?: unknown;
};

function canLock(pack: Record<string, unknown> | null | undefined) {
  const settlement = (pack?.settlement || {}) as Record<string, unknown>;
  const status = String(settlement.status || "").trim().toLowerCase();
  const resolutionStatus = String(settlement.resolutionStatus || "").trim();
  return status === "collected" || status === "locked" || Boolean(resolutionStatus);
}

export async function POST(req: Request) {
  const startedAt = Date.now();
  try {
    requireAdminKey(req);
    const body = await readJson<Body>(req);
    const businessId = String(body.businessId || "").trim();
    const weekKey = String(body.weekKey || "").trim();
    const lock = Boolean(body.lock);
    const forceNewVersion = Boolean(body.forceNewVersion);
    const generatedByRaw = String(body.generatedBy || "admin").trim().toLowerCase();
    const generatedBy =
      generatedByRaw === "merchant" || generatedByRaw === "cron" || generatedByRaw === "admin"
        ? generatedByRaw
        : "admin";
    const ttlSecondsRaw = Number(body.ttlSeconds || 1800);
    const ttlSeconds = Math.max(
      1,
      Math.min(86400, Math.floor(Number.isFinite(ttlSecondsRaw) ? ttlSecondsRaw : 1800))
    );

    if (!mongoose.Types.ObjectId.isValid(businessId)) {
      return fail("VALIDATION_ERROR", "Invalid businessId.", 400);
    }
    if (!weekKey) return fail("VALIDATION_ERROR", "weekKey is required.", 400);

    await dbConnect();
    const archiveResult = await ensureStatementArchive({
      businessId,
      weekKey,
      generatedBy: generatedBy as "admin" | "merchant" | "cron",
      forceNewVersion,
    });

    let archive = archiveResult.archive;
    if (lock) {
      const packRecord = (archive.pack || {}) as Record<string, unknown>;
      if (!canLock(packRecord)) {
        return fail(
          "LOCK_PRECONDITION_FAILED",
          "Statement can be locked only when settlement is collected/locked or has resolution status.",
          409
        );
      }
      await StatementArchive.updateOne(
        { _id: new mongoose.Types.ObjectId(String(archive._id)) },
        { $set: { locked: true, lockedAt: new Date() } }
      );
      const refreshed = await getLatestStatementArchive(businessId, weekKey);
      if (refreshed) archive = refreshed;
    }

    await ensureStatementArchivePdf(String(archive._id));

    const version = Number(archive.version || 1);
    const links = {
      pdf: createStatementDownloadLink({ businessId, weekKey, version, kind: "pdf", ttlSeconds }).url,
      json: createStatementDownloadLink({ businessId, weekKey, version, kind: "json", ttlSeconds }).url,
      csvOrders: createStatementDownloadLink({
        businessId,
        weekKey,
        version,
        kind: "csv_orders",
        ttlSeconds,
      }).url,
      csvSummary: createStatementDownloadLink({
        businessId,
        weekKey,
        version,
        kind: "csv_summary",
        ttlSeconds,
      }).url,
    };

    logRequest(req, {
      route: "admin.statements.archive",
      status: 200,
      durationMs: Date.now() - startedAt,
      extra: {
        businessId,
        weekKey,
        version,
        lock,
        created: archiveResult.created,
      },
    });

    return ok({
      archiveMeta: {
        id: String(archive._id),
        businessId,
        businessName: String(archive.businessName || "Business"),
        weekKey,
        version,
        packHash: String(archive.packHash || ""),
        generatedAt: archive.generatedAt || null,
        generatedBy: archive.generatedBy || generatedBy,
        locked: Boolean(archive.locked),
        lockedAt: archive.lockedAt || null,
      },
      links,
    });
  } catch (error: unknown) {
    const err = error as ApiError;
    const status = err.status || 500;
    logRequest(req, {
      route: "admin.statements.archive",
      status,
      durationMs: Date.now() - startedAt,
      extra: {
        message: err.message || "Could not archive statement pack.",
      },
    });
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not archive statement pack.",
      status
    );
  }
}
