import Link from "next/link";
import { getWeekKey } from "@/lib/geo";
import FinanceMismatchesPanel from "@/app/admin/ops/FinanceMismatchesPanel";
import { getAdminPageContext, pickAdminSearchParam } from "@/lib/adminPageContext";

type SearchParams = Record<string, string | string[] | undefined>;

type FinanceMismatchRow = {
  businessId: string;
  businessName: string;
  weekKey: string;
  deliveredAgg: {
    deliveredOrdersCount: number;
    deliveredGrossSubtotal: number;
    deliveredNetSubtotal: number;
    deliveredCommissionTotal: number;
  };
  settlement: {
    settlementOrdersCount: number;
    settlementGrossSubtotal: number;
    settlementFeeTotal: number;
    settlementStatus: "pending" | "collected" | "locked" | null;
  } | null;
  cash: {
    cashStatus: "open" | "submitted" | "verified" | "disputed" | "closed";
    reportedGross: number | null;
    reportedCommission: number | null;
    reportedNet: number | null;
    expectedHash: string;
    integrityStatus: "ok" | "mismatch";
    verifiedAt: string | null;
    submittedAt: string | null;
  } | null;
  adjustments: {
    count: number;
    total: number;
  };
  diffs: {
    diffOrders: number | null;
    diffGrossSubtotal: number | null;
    diffFeeTotal: number | null;
    diffCashNetVsDeliveredNet: number | null;
    diffCashCommissionVsDeliveredCommission: number | null;
  };
  flags: {
    missingSettlement: boolean;
    missingCashCollection: boolean;
    settlementCollectedButNoCash: boolean;
    hashMismatch: boolean;
    integrityMismatch: boolean;
    diffOverThreshold: boolean;
  };
};

type FinanceSummary = {
  totalRows: number;
  returnedRows: number;
  mismatchRows: number;
  missingSettlementCount: number;
  missingCashCount: number;
  hashMismatchCount: number;
  overThresholdCount: number;
  thresholds?: {
    ordersThreshold: number;
    moneyThresholdRdp: number;
  };
};

type FinanceAnomalies = {
  countsByType?: Record<string, number>;
  latest?: Array<{
    id: string;
    type: string;
    severity: "low" | "medium" | "high" | null;
    businessId: string;
    businessName: string;
    weekKey: string;
    createdAt: string | null;
  }>;
};

type FinanceMismatchResponse = {
  ok?: boolean;
  weekKey?: string;
  summary?: FinanceSummary;
  rows?: FinanceMismatchRow[];
  anomalies?: FinanceAnomalies;
  error?: { message?: string } | string;
};

function pickError(error: unknown, fallback: string) {
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message?: string }).message || fallback);
  }
  return fallback;
}

async function fetchJson<T>(
  url: string,
  requestHeaders?: HeadersInit
): Promise<{ ok: boolean; data: T | null; error: string }> {
  try {
    const res = await fetch(url, { cache: "no-store", headers: requestHeaders });
    const json = (await res.json().catch(() => null)) as
      | (T & { ok?: boolean; error?: { message?: string } | string })
      | null;
    if (!res.ok || !json?.ok) {
      return {
        ok: false,
        data: null,
        error: pickError(json?.error, `HTTP ${res.status}`),
      };
    }
    return { ok: true, data: json, error: "" };
  } catch (error: unknown) {
    return {
      ok: false,
      data: null,
      error: error instanceof Error ? error.message : "Request failed",
    };
  }
}

export default async function AdminFinanceMismatchesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const weekKey =
    pickAdminSearchParam(params.weekKey).trim() || getWeekKey(new Date());
  const businessId = pickAdminSearchParam(params.businessId).trim();
  const limitRaw = Number(pickAdminSearchParam(params.limit) || 200);
  const limit = Number.isFinite(limitRaw)
    ? Math.max(1, Math.min(200, Math.floor(limitRaw)))
    : 200;
  const nextHref = `/admin/finance-mismatches?${new URLSearchParams({
    ...(weekKey ? { weekKey } : {}),
    ...(businessId ? { businessId } : {}),
    limit: String(limit),
  }).toString()}`;
  const { baseUrl, adminRequestHeaders, hasAdminSession, transitionalAdminKey } =
    await getAdminPageContext(params);

  if (!hasAdminSession && !transitionalAdminKey) {
    return (
      <main className="mx-auto min-h-screen max-w-6xl p-6">
        <h1 className="text-2xl font-bold">Finance Mismatches</h1>
        <p className="mt-2 text-sm text-red-600">
          Finance mismatch access requires a secure admin browser session.
        </p>
        <Link
          href={`/admin/access?next=${encodeURIComponent(nextHref)}`}
          className="mt-4 inline-flex rounded-lg bg-slate-950 px-4 py-2 text-sm font-semibold text-white"
        >
          Open admin access
        </Link>
      </main>
    );
  }

  const query = new URLSearchParams({
    weekKey,
    limit: String(limit),
  });
  if (businessId) query.set("businessId", businessId);

  const mismatchesReq = await fetchJson<FinanceMismatchResponse>(
    `${baseUrl}/api/admin/finance/mismatches?${query.toString()}`,
    adminRequestHeaders
  );

  const rows = Array.isArray(mismatchesReq.data?.rows) ? mismatchesReq.data?.rows || [] : [];
  const summary = mismatchesReq.data?.summary || {
    totalRows: 0,
    returnedRows: 0,
    mismatchRows: 0,
    missingSettlementCount: 0,
    missingCashCount: 0,
    hashMismatchCount: 0,
    overThresholdCount: 0,
  };

  return (
    <main className="mx-auto min-h-screen max-w-7xl p-6">
      <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Finance Mismatches</h1>
          <p className="text-sm text-slate-600">
            Review settlement, cash, and delivered-order finance alignment without opening raw JSON API responses.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/admin"
            className="rounded border border-slate-300 bg-white px-3 py-2 text-sm font-semibold"
          >
            Admin Home
          </Link>
          <Link
            href="/admin/ops"
            className="rounded border border-slate-300 bg-white px-3 py-2 text-sm font-semibold"
          >
            Ops Center
          </Link>
          <Link
            href={nextHref}
            className="rounded border border-slate-300 bg-white px-3 py-2 text-sm font-semibold"
          >
            Refresh
          </Link>
        </div>
      </header>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap gap-2 text-xs font-semibold">
          <span className="rounded-full bg-slate-100 px-3 py-1 text-slate-700">
            week: {weekKey}
          </span>
          <span className="rounded-full bg-slate-100 px-3 py-1 text-slate-700">
            businessId: {businessId || "all"}
          </span>
          <span className="rounded-full bg-slate-100 px-3 py-1 text-slate-700">
            limit: {limit}
          </span>
        </div>
        {mismatchesReq.ok ? null : (
          <p className="mt-3 text-sm text-red-600">{mismatchesReq.error}</p>
        )}
      </section>

      <FinanceMismatchesPanel
        adminKey={transitionalAdminKey}
        defaultWeekKey={String(mismatchesReq.data?.weekKey || weekKey)}
        initialRows={rows}
        initialSummary={summary}
        initialAnomalies={mismatchesReq.data?.anomalies || {}}
        initialBusinessIdFilter={businessId}
        fetchError={mismatchesReq.ok ? "" : mismatchesReq.error}
      />
    </main>
  );
}
