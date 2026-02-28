import fs from "node:fs/promises";
import path from "node:path";
import { ok, fail, readJson } from "@/lib/apiResponse";
import { dbConnect } from "@/lib/mongodb";
import { requireAdminKey } from "@/lib/adminAuth";
import { BackupRun } from "@/models/BackupRun";
import { Order } from "@/models/Order";
import { Settlement } from "@/models/Settlement";
import { CashCollection } from "@/models/CashCollection";

type ApiError = Error & { status?: number; code?: string };
type BackupKind = "orders" | "settlements" | "cashCollections" | "all";

type JobBody = {
  kind?: BackupKind;
  sinceDays?: number;
};

type ParsedInput = {
  kind: BackupKind;
  sinceDays: number;
  sinceDate: Date;
};

type BackupFile = {
  name: string;
  sizeBytes: number;
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

function parseKind(rawValue: unknown): BackupKind | null {
  const value = String(rawValue || "").trim();
  if (!value) return "all";
  if (value === "orders" || value === "settlements" || value === "cashCollections" || value === "all") {
    return value;
  }
  return null;
}

function parseSinceDays(rawValue: unknown) {
  if (rawValue === undefined || rawValue === null || String(rawValue).trim() === "") return 7;
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed)) return null;
  const whole = Math.floor(parsed);
  if (whole < 1 || whole > 30) return null;
  return Math.max(1, Math.min(30, whole));
}

function resolveInput(req: Request, body?: JobBody): ParsedInput {
  const url = new URL(req.url);
  const kind = parseKind(body?.kind ?? url.searchParams.get("kind"));
  if (!kind) {
    const err = new Error("Invalid kind. Use orders, settlements, cashCollections, or all.") as Error & {
      status?: number;
      code?: string;
    };
    err.status = 400;
    err.code = "VALIDATION_ERROR";
    throw err;
  }
  const sinceDays = parseSinceDays(body?.sinceDays ?? url.searchParams.get("sinceDays"));
  if (sinceDays == null) {
    const err = new Error("Invalid sinceDays. Use a number between 1 and 30.") as Error & {
      status?: number;
      code?: string;
    };
    err.status = 400;
    err.code = "VALIDATION_ERROR";
    throw err;
  }
  return {
    kind,
    sinceDays,
    sinceDate: new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000),
  };
}

async function writeJsonlFromRows(
  rows: AsyncIterable<Record<string, unknown>>,
  filePath: string
) {
  const handle = await fs.open(filePath, "w");
  let count = 0;
  try {
    for await (const row of rows) {
      await handle.appendFile(`${JSON.stringify(row)}\n`, "utf8");
      count += 1;
    }
  } finally {
    await handle.close();
  }
  const stat = await fs.stat(filePath);
  return { count, sizeBytes: stat.size };
}

async function runBackupExport(input: ParsedInput) {
  await dbConnect();
  const startedAt = new Date();
  const run = await BackupRun.create({
    kind: input.kind,
    status: "running",
    startedAt,
    counts: {
      orders: 0,
      settlements: 0,
      cashCollections: 0,
    },
    fileMeta: {
      filename: "",
      sizeBytes: 0,
    },
  });

  const runId = String(run._id);
  const tmpRoot = path.resolve("/tmp", "aisha-backups");
  await fs.mkdir(tmpRoot, { recursive: true });
  const runDir = path.join(tmpRoot, runId);
  await fs.mkdir(runDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const prefix = `backup-${timestamp}-${runId}`;

  const counts = {
    orders: 0,
    settlements: 0,
    cashCollections: 0,
  };
  const files: BackupFile[] = [];

  try {
    const includeOrders = input.kind === "orders" || input.kind === "all";
    const includeSettlements = input.kind === "settlements" || input.kind === "all";
    const includeCashCollections = input.kind === "cashCollections" || input.kind === "all";

    if (includeOrders) {
      const filename = `${prefix}-orders.jsonl`;
      const filePath = path.join(runDir, filename);
      const rows = Order.find({ createdAt: { $gte: input.sinceDate } })
        .sort({ createdAt: 1 })
        .lean()
        .cursor() as AsyncIterable<Record<string, unknown>>;
      const result = await writeJsonlFromRows(rows, filePath);
      counts.orders = result.count;
      files.push({ name: filename, sizeBytes: result.sizeBytes });
    }

    if (includeSettlements) {
      const filename = `${prefix}-settlements.jsonl`;
      const filePath = path.join(runDir, filename);
      const rows = Settlement.find({ createdAt: { $gte: input.sinceDate } })
        .sort({ createdAt: 1 })
        .lean()
        .cursor() as AsyncIterable<Record<string, unknown>>;
      const result = await writeJsonlFromRows(rows, filePath);
      counts.settlements = result.count;
      files.push({ name: filename, sizeBytes: result.sizeBytes });
    }

    if (includeCashCollections) {
      const filename = `${prefix}-cashcollections.jsonl`;
      const filePath = path.join(runDir, filename);
      const rows = CashCollection.find({ createdAt: { $gte: input.sinceDate } })
        .sort({ createdAt: 1 })
        .lean()
        .cursor() as AsyncIterable<Record<string, unknown>>;
      const result = await writeJsonlFromRows(rows, filePath);
      counts.cashCollections = result.count;
      files.push({ name: filename, sizeBytes: result.sizeBytes });
    }

    const manifestFilename = `${prefix}-manifest.json`;
    const manifestPath = path.join(runDir, manifestFilename);
    await fs.writeFile(
      manifestPath,
      JSON.stringify(
        {
          runId,
          kind: input.kind,
          sinceDays: input.sinceDays,
          sinceDate: input.sinceDate.toISOString(),
          startedAt,
          finishedAt: new Date().toISOString(),
          counts,
          files,
          downloadUrlPlaceholder: `/tmp/aisha-backups/${runId}`,
        },
        null,
        2
      ),
      "utf8"
    );
    const manifestStat = await fs.stat(manifestPath);
    files.push({
      name: manifestFilename,
      sizeBytes: manifestStat.size,
    });

    await BackupRun.updateOne(
      { _id: run._id },
      {
        $set: {
          status: "success",
          finishedAt: new Date(),
          counts,
          fileMeta: {
            filename: manifestFilename,
            sizeBytes: manifestStat.size,
          },
          errorMessage: null,
        },
      }
    );

    return {
      runId,
      status: "success" as const,
      counts,
      files,
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Backup export failed.";
    await BackupRun.updateOne(
      { _id: run._id },
      {
        $set: {
          status: "failed",
          finishedAt: new Date(),
          counts,
          errorMessage: message.slice(0, 500),
        },
      }
    );
    throw error;
  }
}

export async function GET(req: Request) {
  try {
    const auth = isAuthorizedCronRequest(req);
    if (!auth.ok) return fail("UNAUTHORIZED", auth.reason, auth.status);
    const input = resolveInput(req);
    const result = await runBackupExport(input);
    return ok({
      runId: result.runId,
      status: result.status,
      counts: result.counts,
      files: result.files,
    });
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not run backup export.",
      err.status || 500
    );
  }
}

export async function POST(req: Request) {
  try {
    requireAdminKey(req);
    const body = await readJson<JobBody>(req).catch(() => ({} as JobBody));
    const input = resolveInput(req, body);
    const result = await runBackupExport(input);
    return ok({
      runId: result.runId,
      status: result.status,
      counts: result.counts,
      files: result.files,
    });
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not run backup export.",
      err.status || 500
    );
  }
}
