import Link from "next/link";
import { getWeekKey } from "@/lib/geo";
import CashReconciliationPanel from "@/app/admin/ops/CashReconciliationPanel";
import { getAdminPageContext, pickAdminSearchParam } from "@/lib/adminPageContext";

type SearchParams = Record<string, string | string[] | undefined>;

type CashCollectionRow = {
  id: string;
  businessId: string;
  businessName: string;
  weekKey: string;
  status: "open" | "submitted" | "verified" | "disputed" | "closed";
  expected: {
    ordersCount: number;
    grossSubtotal: number;
    promoDiscountTotal: number;
    netSubtotal: number;
    commissionTotal: number;
  };
  reported: {
    cashCollected: number | null;
    grossSubtotal?: number | null;
    netSubtotal?: number | null;
    commissionTotal?: number | null;
    ordersCount: number | null;
    collectorName: string | null;
    collectionMethod:
      | "in_person"
      | "bank_deposit"
      | "bank_transfer"
      | "transfer"
      | "pickup"
      | "other"
      | null;
    receiptPhotoUrl: string | null;
    receiptRef: string | null;
    reportedAt: string | null;
  };
  discrepancy: {
    cashDiff: number;
    ordersDiff: number;
  };
  integrity: {
    expectedHash: string;
    computedAt: string | null;
    status?: "ok" | "mismatch";
  };
  driverCash?: {
    driverCollectedTotalRdp?: number;
    driverHandedTotalRdp?: number;
    driverDisputedTotalRdp?: number;
    merchantCashReceivedTotalRdp?: number;
    mismatchSignal?: boolean;
  };
  proofComplete?: boolean;
  missingProofFields?: string[];
  submittedAt?: string | null;
  verifiedAt?: string | null;
  updatedAt: string | null;
};

type CashCollectionSummary = {
  totalExpectedNet: number;
  totalReportedCash: number;
  totalCashDiff: number;
  submittedCount: number;
  verifiedCount: number;
  disputedCount: number;
  openCount: number;
  closedCount: number;
  driverCollectedTotalRdp?: number;
  driverHandedTotalRdp?: number;
  driverDisputedTotalRdp?: number;
  driverMismatchCount?: number;
};

type CashCollectionResponse = {
  ok?: boolean;
  weekKey?: string;
  rows?: CashCollectionRow[];
  summary?: CashCollectionSummary;
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

export default async function AdminCashCollectionsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const weekKey =
    pickAdminSearchParam(params.weekKey).trim() || getWeekKey(new Date());
  const q = pickAdminSearchParam(params.q).trim();
  const limitRaw = Number(pickAdminSearchParam(params.limit) || 200);
  const limit = Number.isFinite(limitRaw)
    ? Math.max(1, Math.min(500, Math.floor(limitRaw)))
    : 200;
  const nextHref = `/admin/cash-collections?${new URLSearchParams({
    ...(weekKey ? { weekKey } : {}),
    ...(q ? { q } : {}),
    limit: String(limit),
  }).toString()}`;
  const { baseUrl, adminRequestHeaders, hasAdminSession, transitionalAdminKey } =
    await getAdminPageContext(params);

  if (!hasAdminSession && !transitionalAdminKey) {
    return (
      <main className="mx-auto min-h-screen max-w-6xl p-6">
        <h1 className="text-2xl font-bold">Cash Collections</h1>
        <p className="mt-2 text-sm text-red-600">
          Cash collections access requires a secure admin browser session.
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
  if (q) query.set("q", q);

  const collectionsReq = await fetchJson<CashCollectionResponse>(
    `${baseUrl}/api/admin/cash-collections?${query.toString()}`,
    adminRequestHeaders
  );

  const rows = Array.isArray(collectionsReq.data?.rows) ? collectionsReq.data?.rows || [] : [];
  const summary = collectionsReq.data?.summary || {
    totalExpectedNet: 0,
    totalReportedCash: 0,
    totalCashDiff: 0,
    submittedCount: 0,
    verifiedCount: 0,
    disputedCount: 0,
    openCount: 0,
    closedCount: 0,
    driverCollectedTotalRdp: 0,
    driverHandedTotalRdp: 0,
    driverDisputedTotalRdp: 0,
    driverMismatchCount: 0,
  };

  return (
    <main className="mx-auto min-h-screen max-w-7xl p-6">
      <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Cash Collections</h1>
          <p className="text-sm text-slate-600">
            Review weekly merchant cash sheets without opening raw JSON API responses.
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
            business search: {q || "all"}
          </span>
          <span className="rounded-full bg-slate-100 px-3 py-1 text-slate-700">
            limit: {limit}
          </span>
        </div>
        {collectionsReq.ok ? null : (
          <p className="mt-3 text-sm text-red-600">{collectionsReq.error}</p>
        )}
      </section>

      <CashReconciliationPanel
        adminKey={transitionalAdminKey}
        initialWeekKey={String(collectionsReq.data?.weekKey || weekKey)}
        initialRows={rows}
        initialSummary={summary}
        initialQuery={q}
        fetchError={collectionsReq.ok ? "" : collectionsReq.error}
      />
    </main>
  );
}
