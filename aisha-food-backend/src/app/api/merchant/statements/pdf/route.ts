import { ok, fail } from "@/lib/apiResponse";
import { requireMerchantSession } from "@/lib/merchantAuth";
import { requireMerchantBusinessAvailable } from "@/lib/merchantBusiness";
import { assertNotInMaintenance } from "@/lib/maintenance";
import { getWeekKey } from "@/lib/geo";
import { logRequest } from "@/lib/logger";
import {
  createStatementDownloadLink,
  ensureStatementArchive,
  ensureStatementArchivePdf,
} from "@/lib/statementArchive";

type ApiError = Error & { status?: number; code?: string };

type RateBucket = {
  count: number;
  resetAt: number;
};

const RATE_LIMIT = 20;
const RATE_WINDOW_MS = 60 * 1000;
const rateBuckets = new Map<string, RateBucket>();

function consumeRateLimit(key: string) {
  const now = Date.now();
  const normalizedKey = String(key || "").trim();
  if (!normalizedKey) return { allowed: true };
  const current = rateBuckets.get(normalizedKey);
  if (!current || now >= current.resetAt) {
    rateBuckets.set(normalizedKey, {
      count: 1,
      resetAt: now + RATE_WINDOW_MS,
    });
    return { allowed: true };
  }
  current.count += 1;
  return { allowed: current.count <= RATE_LIMIT };
}

export async function GET(req: Request) {
  const startedAt = Date.now();
  try {
    await assertNotInMaintenance();
    const session = requireMerchantSession(req);
    await requireMerchantBusinessAvailable(session.businessId);

    const rate = consumeRateLimit(session.businessId);
    if (!rate.allowed) {
      return fail("RATE_LIMIT", "Too many requests. Try later.", 429);
    }

    const url = new URL(req.url);
    const weekKey = String(url.searchParams.get("weekKey") || "").trim() || getWeekKey(new Date());
    const action = String(url.searchParams.get("action") || "link").trim().toLowerCase();
    const ttlSecondsRaw = Number(url.searchParams.get("ttlSeconds") || 1800);
    const ttlSeconds = Math.max(1, Math.min(86400, Math.floor(Number.isFinite(ttlSecondsRaw) ? ttlSecondsRaw : 1800)));

    const archiveResult = await ensureStatementArchive({
      businessId: session.businessId,
      weekKey,
      generatedBy: "merchant",
      forceNewVersion: false,
    });
    const archiveId = String(archiveResult.archive._id);

    if (action === "generate") {
      await ensureStatementArchivePdf(archiveId);
    }

    const pdfLink = createStatementDownloadLink({
      businessId: session.businessId,
      weekKey,
      version: Number(archiveResult.archive.version || 1),
      kind: "pdf",
      ttlSeconds,
    });
    const jsonLink = createStatementDownloadLink({
      businessId: session.businessId,
      weekKey,
      version: Number(archiveResult.archive.version || 1),
      kind: "json",
      ttlSeconds,
    });
    const csvOrdersLink = createStatementDownloadLink({
      businessId: session.businessId,
      weekKey,
      version: Number(archiveResult.archive.version || 1),
      kind: "csv_orders",
      ttlSeconds,
    });
    const csvSummaryLink = createStatementDownloadLink({
      businessId: session.businessId,
      weekKey,
      version: Number(archiveResult.archive.version || 1),
      kind: "csv_summary",
      ttlSeconds,
    });

    logRequest(req, {
      route: "merchant.statements.pdf",
      status: 200,
      durationMs: Date.now() - startedAt,
      extra: {
        businessId: session.businessId,
        weekKey,
        action,
        version: archiveResult.archive.version,
      },
    });

    return ok({
      archive: {
        id: archiveId,
        businessId: session.businessId,
        businessName: String(archiveResult.archive.businessName || "Business"),
        weekKey,
        version: Number(archiveResult.archive.version || 1),
        generatedAt: archiveResult.archive.generatedAt || null,
        generatedBy: archiveResult.archive.generatedBy || "merchant",
        locked: Boolean(archiveResult.archive.locked),
        lockedAt: archiveResult.archive.lockedAt || null,
        packHash: String(archiveResult.archive.packHash || ""),
      },
      links: {
        pdf: pdfLink.url,
        json: jsonLink.url,
        csvOrders: csvOrdersLink.url,
        csvSummary: csvSummaryLink.url,
      },
      url: pdfLink.url,
    });
  } catch (error: unknown) {
    const err = error as ApiError;
    const status = err.status || 500;
    logRequest(req, {
      route: "merchant.statements.pdf",
      status,
      durationMs: Date.now() - startedAt,
      extra: { message: err.message || "Could not create statement PDF link." },
    });
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not create statement PDF link.",
      status
    );
  }
}
