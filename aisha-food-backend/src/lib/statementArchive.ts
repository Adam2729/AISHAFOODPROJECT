import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { sha256StableStringify } from "@/lib/integrityHash";
import { createSignedToken } from "@/lib/signedLink";
import { renderStatementPdf } from "@/lib/pdf/statementPdf";
import { computeWeeklyStatementPack } from "@/lib/weeklyStatement";
import type { StatementPack } from "@/lib/statementFormats";
import { StatementArchive } from "@/models/StatementArchive";

export type StatementKind = "pdf" | "json" | "csv_orders" | "csv_summary";

type ArchiveLean = {
  _id: mongoose.Types.ObjectId;
  businessId: mongoose.Types.ObjectId;
  businessName: string;
  weekKey: string;
  version: number;
  packHash: string;
  pack: StatementPack;
  pdfBase64?: string | null;
  generatedAt?: Date | null;
  generatedBy?: "cron" | "admin" | "merchant";
  locked?: boolean;
  lockedAt?: Date | null;
};

const PDF_SIZE_LIMIT_BYTES = 2 * 1024 * 1024;

function normalizeGeneratedBy(value: unknown): "cron" | "admin" | "merchant" {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "cron" || normalized === "admin" || normalized === "merchant") {
    return normalized;
  }
  return "admin";
}

export function statementDownloadPath(token: string) {
  return `/api/public/statements/download?token=${encodeURIComponent(token)}`;
}

export function createStatementDownloadLink(input: {
  businessId: string;
  weekKey: string;
  version: number;
  kind: StatementKind;
  ttlSeconds?: number;
}) {
  const token = createSignedToken(
    {
      businessId: String(input.businessId || "").trim(),
      weekKey: String(input.weekKey || "").trim(),
      version: Number(input.version || 1),
      kind: input.kind,
    },
    Math.max(1, Math.floor(Number(input.ttlSeconds || 1800)))
  );
  return {
    token,
    url: statementDownloadPath(token),
  };
}

export async function getLatestStatementArchive(businessId: string, weekKey: string) {
  await dbConnect();
  if (!mongoose.Types.ObjectId.isValid(businessId)) return null;
  const row = await StatementArchive.findOne({
    businessId: new mongoose.Types.ObjectId(businessId),
    weekKey: String(weekKey || "").trim(),
  })
    .sort({ version: -1, generatedAt: -1, createdAt: -1 })
    .lean<ArchiveLean | null>();
  return row;
}

export async function ensureStatementArchive(input: {
  businessId: string;
  weekKey: string;
  generatedBy?: "cron" | "admin" | "merchant";
  forceNewVersion?: boolean;
}) {
  await dbConnect();
  const businessId = String(input.businessId || "").trim();
  const weekKey = String(input.weekKey || "").trim();
  if (!mongoose.Types.ObjectId.isValid(businessId)) {
    throw new Error("Invalid businessId.");
  }
  if (!weekKey) {
    throw new Error("weekKey is required.");
  }

  const normalizedGeneratedBy = normalizeGeneratedBy(input.generatedBy);
  const latest = await getLatestStatementArchive(businessId, weekKey);
  const pack = (await computeWeeklyStatementPack(businessId, weekKey)) as StatementPack;
  const packHash = sha256StableStringify(pack);

  if (latest && !input.forceNewVersion && String(latest.packHash || "") === packHash) {
    return {
      created: false,
      archive: latest,
    };
  }

  const nextVersion = latest ? Math.max(1, Number(latest.version || 1) + 1) : 1;
  const created = await StatementArchive.create({
    businessId: new mongoose.Types.ObjectId(businessId),
    businessName: String(pack.businessName || "Business"),
    weekKey,
    version: nextVersion,
    packHash,
    pack,
    generatedAt: new Date(),
    generatedBy: normalizedGeneratedBy,
    locked: false,
    lockedAt: null,
  });

  return {
    created: true,
    archive: created.toObject() as ArchiveLean,
  };
}

export async function ensureStatementArchivePdf(archiveId: string) {
  await dbConnect();
  if (!mongoose.Types.ObjectId.isValid(archiveId)) {
    throw new Error("Invalid archiveId.");
  }
  const archive = await StatementArchive.findById(archiveId).lean<ArchiveLean | null>();
  if (!archive) {
    throw new Error("Statement archive not found.");
  }
  if (archive.pdfBase64) {
    return {
      updated: false,
      pdfBase64: archive.pdfBase64,
      bytes: Buffer.byteLength(archive.pdfBase64, "base64"),
    };
  }

  const pdfBuffer = await renderStatementPdf(archive.pack);
  if (pdfBuffer.byteLength > PDF_SIZE_LIMIT_BYTES) {
    const err = new Error("Generated PDF exceeds maximum allowed size.") as Error & {
      status?: number;
      code?: string;
    };
    err.status = 413;
    err.code = "PDF_TOO_LARGE";
    throw err;
  }

  const pdfBase64 = pdfBuffer.toString("base64");
  await StatementArchive.updateOne(
    { _id: new mongoose.Types.ObjectId(archiveId) },
    { $set: { pdfBase64 } }
  );
  return {
    updated: true,
    pdfBase64,
    bytes: pdfBuffer.byteLength,
  };
}
