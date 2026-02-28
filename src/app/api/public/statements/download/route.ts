import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { fail } from "@/lib/apiResponse";
import { assertNotInMaintenance } from "@/lib/maintenance";
import { logRequest } from "@/lib/logger";
import { verifySignedToken } from "@/lib/signedLink";
import { buildOrdersCsv, buildSummaryCsv, type StatementPack } from "@/lib/statementFormats";
import { ensureStatementArchivePdf } from "@/lib/statementArchive";
import { StatementArchive } from "@/models/StatementArchive";

type ApiError = Error & { status?: number; code?: string };

type TokenPayload = {
  businessId: string;
  weekKey: string;
  version: number;
  kind: "pdf" | "json" | "csv_orders" | "csv_summary";
  exp: number;
};

type ArchiveLean = {
  _id: mongoose.Types.ObjectId;
  businessId: mongoose.Types.ObjectId;
  businessName: string;
  weekKey: string;
  version: number;
  pack: StatementPack;
  pdfBase64?: string | null;
};

export async function GET(req: Request) {
  const startedAt = Date.now();
  try {
    await assertNotInMaintenance();
    const url = new URL(req.url);
    const token = String(url.searchParams.get("token") || "").trim();
    if (!token) return fail("VALIDATION_ERROR", "token is required.", 400);

    const payload = verifySignedToken<TokenPayload>(token);
    if (!payload) return fail("UNAUTHORIZED", "Invalid or expired token.", 401);
    if (!mongoose.Types.ObjectId.isValid(String(payload.businessId || ""))) {
      return fail("UNAUTHORIZED", "Invalid token payload.", 401);
    }
    if (!payload.weekKey || !payload.kind || !payload.version) {
      return fail("UNAUTHORIZED", "Invalid token payload.", 401);
    }

    await dbConnect();
    const archive = await StatementArchive.findOne({
      businessId: new mongoose.Types.ObjectId(payload.businessId),
      weekKey: String(payload.weekKey || "").trim(),
      version: Number(payload.version || 1),
    }).lean<ArchiveLean | null>();

    if (!archive) return fail("NOT_FOUND", "Statement archive not found.", 404);

    const businessNameSlug = String(archive.businessName || "business")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60);
    const baseFile = `statement-${businessNameSlug || "business"}-${archive.weekKey}-v${archive.version}`;

    if (payload.kind === "json") {
      logRequest(req, {
        route: "public.statements.download",
        status: 200,
        durationMs: Date.now() - startedAt,
        extra: { kind: payload.kind, weekKey: archive.weekKey, version: archive.version },
      });
      return new Response(JSON.stringify({ ok: true, pack: archive.pack }), {
        status: 200,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Content-Disposition": `attachment; filename="${baseFile}.json"`,
          "Cache-Control": "no-store",
        },
      });
    }

    if (payload.kind === "csv_orders") {
      const csv = buildOrdersCsv(archive.pack);
      logRequest(req, {
        route: "public.statements.download",
        status: 200,
        durationMs: Date.now() - startedAt,
        extra: { kind: payload.kind, weekKey: archive.weekKey, version: archive.version },
      });
      return new Response(csv, {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="${baseFile}-orders.csv"`,
          "Cache-Control": "no-store",
        },
      });
    }

    if (payload.kind === "csv_summary") {
      const csv = buildSummaryCsv(archive.pack);
      logRequest(req, {
        route: "public.statements.download",
        status: 200,
        durationMs: Date.now() - startedAt,
        extra: { kind: payload.kind, weekKey: archive.weekKey, version: archive.version },
      });
      return new Response(csv, {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="${baseFile}-summary.csv"`,
          "Cache-Control": "no-store",
        },
      });
    }

    const pdfResult = await ensureStatementArchivePdf(String(archive._id));
    const pdfBuffer = Buffer.from(pdfResult.pdfBase64, "base64");
    logRequest(req, {
      route: "public.statements.download",
      status: 200,
      durationMs: Date.now() - startedAt,
      extra: {
        kind: payload.kind,
        weekKey: archive.weekKey,
        version: archive.version,
        bytes: pdfBuffer.byteLength,
      },
    });
    return new Response(pdfBuffer, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${baseFile}.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error: unknown) {
    const err = error as ApiError;
    const status = err.status || 500;
    logRequest(req, {
      route: "public.statements.download",
      status,
      durationMs: Date.now() - startedAt,
      extra: {
        message: err.message || "Could not download statement file.",
      },
    });
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not download statement file.",
      status
    );
  }
}
