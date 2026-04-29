import { ok, fail } from "@/lib/apiResponse";
import { requireAdminKey } from "@/lib/adminAuth";
import { getWeekKey } from "@/lib/geo";
import { dbConnect } from "@/lib/mongodb";
import { SettlementPreview } from "@/models/SettlementPreview";

type ApiError = Error & { status?: number; code?: string };

type PreviewDoc = {
  businessId: string;
  businessName: string;
  weekKey: string;
  mismatch: boolean;
  expectedOrdersCount: number;
  expectedGrossSubtotal: number;
  expectedFeeTotal: number;
  storedExists: boolean;
  storedOrdersCount: number | null;
  storedGrossSubtotal: number | null;
  storedFeeTotal: number | null;
  integrityHasHash: boolean;
  integrityHashMatches: boolean | null;
  diffOrdersCount: number | null;
  diffGrossSubtotal: number | null;
  diffFeeTotal: number | null;
  generatedAt: string | Date;
};

function parseLimit(raw: string | null) {
  const parsed = Number(raw || 20);
  if (!Number.isFinite(parsed) || parsed <= 0) return 20;
  return Math.min(100, Math.floor(parsed));
}

function parseMismatchOnly(raw: string | null) {
  if (!raw) return true;
  const value = raw.trim().toLowerCase();
  if (["false", "0", "no"].includes(value)) return false;
  return true;
}

export async function GET(req: Request) {
  try {
    requireAdminKey(req);
    const url = new URL(req.url);
    const weekKey = String(url.searchParams.get("weekKey") || "").trim() || getWeekKey(new Date());
    const mismatchOnly = parseMismatchOnly(url.searchParams.get("mismatchOnly"));
    const limit = parseLimit(url.searchParams.get("limit"));

    await dbConnect();
    const match: Record<string, unknown> = { weekKey };
    if (mismatchOnly) match.mismatch = true;

    const previews = await SettlementPreview.aggregate<PreviewDoc>([
      { $match: match },
      {
        $addFields: {
          diffFeeAbs: { $abs: { $ifNull: ["$diffFeeTotal", 0] } },
        },
      },
      {
        $sort: {
          mismatch: -1,
          diffFeeAbs: -1,
          generatedAt: -1,
        },
      },
      { $limit: limit },
      {
        $project: {
          _id: 0,
          businessId: { $toString: "$businessId" },
          businessName: 1,
          weekKey: 1,
          mismatch: 1,
          expectedOrdersCount: 1,
          expectedGrossSubtotal: 1,
          expectedFeeTotal: 1,
          storedExists: 1,
          storedOrdersCount: 1,
          storedGrossSubtotal: 1,
          storedFeeTotal: 1,
          integrityHasHash: 1,
          integrityHashMatches: 1,
          diffOrdersCount: 1,
          diffGrossSubtotal: 1,
          diffFeeTotal: 1,
          generatedAt: 1,
        },
      },
    ]);

    return ok({
      weekKey,
      previews,
    });
  } catch (e: unknown) {
    const err = e as ApiError;
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not load settlement previews.",
      err.status || 500
    );
  }
}
