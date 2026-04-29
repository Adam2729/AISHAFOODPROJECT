"use client";

import { useEffect, useMemo, useState } from "react";

type DriverRow = {
  payoutId: string;
  orderId: string;
  businessId: string;
  amount: number;
  deliveryFeeCharged: number;
  platformMargin: number;
  status: string;
  createdAt: string | Date | null;
  paidAt: string | Date | null;
  driverRef?: string;
};

type DriverResponse = {
  ok: boolean;
  cityId?: string;
  cityCode?: string;
  weekKey?: string;
  driverId?: string;
  driverRef?: string;
  totals?: {
    pendingCount?: number;
    pendingAmount?: number;
    paidCount?: number;
    paidAmount?: number;
  };
  cash?: {
    cashCollectedByRider?: number;
    cashDueToRider?: number;
    cashDueToPlatform?: number;
    netSettlement?: number;
  };
  rows?: DriverRow[];
  page?: number;
  pageSize?: number;
  hasMore?: boolean;
  error?: { message?: string } | string;
};

type BulkPayResponse = {
  ok: boolean;
  requestedCount?: number;
  updatedCount?: number;
  skippedCount?: number;
  skipped?: Array<{ payoutId: string; reason: string }>;
  error?: { message?: string } | string;
};

function money(value: unknown) {
  return Number(value || 0).toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

function formatDate(value: string | Date | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString();
}

function pickError(error: unknown, fallback: string) {
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message?: string }).message || fallback);
  }
  return fallback;
}

export default function DriverOpsDriverClient({
  adminKey,
  cityId,
  weekKey,
  driverId,
}: {
  adminKey: string;
  cityId: string;
  weekKey: string;
  driverId: string;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [pendingRows, setPendingRows] = useState<DriverRow[]>([]);
  const [paidRows, setPaidRows] = useState<DriverRow[]>([]);
  const [meta, setMeta] = useState<{
    driverRef: string;
    totals: {
      pendingCount: number;
      pendingAmount: number;
      paidCount: number;
      paidAmount: number;
    };
    cash: {
      cashCollectedByRider: number;
      cashDueToRider: number;
      cashDueToPlatform: number;
      netSettlement: number;
    };
  }>({
    driverRef: "",
    totals: { pendingCount: 0, pendingAmount: 0, paidCount: 0, paidAmount: 0 },
    cash: { cashCollectedByRider: 0, cashDueToRider: 0, cashDueToPlatform: 0, netSettlement: 0 },
  });
  const [selectedMap, setSelectedMap] = useState<Record<string, boolean>>({});
  const [paying, setPaying] = useState(false);

  async function fetchDriver(status: "pending" | "paid") {
    const params = new URLSearchParams({
      key: adminKey,
      cityId,
      weekKey,
      driverId,
      status,
      page: "1",
      pageSize: "200",
    });
    const res = await fetch(`/api/ops/driver-ops/driver?${params.toString()}`, {
      cache: "no-store",
    });
    const json = (await res.json().catch(() => null)) as DriverResponse | null;
    if (!res.ok || !json?.ok) {
      throw new Error(pickError(json?.error, `Could not load ${status} rows.`));
    }
    return json;
  }

  async function loadData() {
    if (!cityId || !weekKey || !driverId) return;
    setLoading(true);
    setError("");
    try {
      const [pendingData, paidData] = await Promise.all([
        fetchDriver("pending"),
        fetchDriver("paid"),
      ]);

      setPendingRows(Array.isArray(pendingData.rows) ? pendingData.rows : []);
      setPaidRows(Array.isArray(paidData.rows) ? paidData.rows : []);
      setSelectedMap({});
      setMeta({
        driverRef: String(pendingData.driverRef || paidData.driverRef || ""),
        totals: {
          pendingCount: Number(pendingData.totals?.pendingCount || 0),
          pendingAmount: Number(pendingData.totals?.pendingAmount || 0),
          paidCount: Number(pendingData.totals?.paidCount || 0),
          paidAmount: Number(pendingData.totals?.paidAmount || 0),
        },
        cash: {
          cashCollectedByRider: Number(pendingData.cash?.cashCollectedByRider || 0),
          cashDueToRider: Number(pendingData.cash?.cashDueToRider || 0),
          cashDueToPlatform: Number(pendingData.cash?.cashDueToPlatform || 0),
          netSettlement: Number(pendingData.cash?.netSettlement || 0),
        },
      });
    } catch (requestError: unknown) {
      setError(requestError instanceof Error ? requestError.message : "Could not load driver detail.");
      setPendingRows([]);
      setPaidRows([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, [cityId, weekKey, driverId]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectedIds = useMemo(
    () =>
      Object.entries(selectedMap)
        .filter(([, selected]) => selected)
        .map(([payoutId]) => payoutId),
    [selectedMap]
  );

  async function bulkPaySelected() {
    if (!selectedIds.length) return;
    setPaying(true);
    setError("");
    setSuccess("");
    try {
      const res = await fetch(`/api/ops/driver-ops/bulk-pay?cityId=${encodeURIComponent(cityId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cityId,
          weekKey,
          payoutIds: selectedIds,
          note: "ops-driver-ops-bulk-pay",
        }),
      });
      const json = (await res.json().catch(() => null)) as BulkPayResponse | null;
      if (!res.ok || !json?.ok) {
        throw new Error(pickError(json?.error, "Could not mark selected payouts as paid."));
      }
      setSuccess(
        `Updated ${Number(json.updatedCount || 0)} payout(s), skipped ${Number(json.skippedCount || 0)}.`
      );
      await loadData();
    } catch (requestError: unknown) {
      setError(requestError instanceof Error ? requestError.message : "Bulk pay failed.");
    } finally {
      setPaying(false);
    }
  }

  return (
    <section className="space-y-4">
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      {success ? <p className="text-sm text-emerald-700">{success}</p> : null}

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-lg font-semibold">
              Driver: {meta.driverRef || driverId}
            </h2>
            <p className="mt-1 font-mono text-xs text-slate-500">{driverId}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(driverId);
                  setSuccess("Driver ID copied.");
                } catch {
                  setError("Could not copy driver ID.");
                }
              }}
              className="rounded border border-slate-300 px-3 py-2 text-sm font-semibold"
            >
              Copy driverId
            </button>
            <a
              href={`/api/ops/driver-ops/export/driver-week.csv?cityId=${encodeURIComponent(cityId)}&weekKey=${encodeURIComponent(
                weekKey
              )}&driverId=${encodeURIComponent(driverId)}`}
              className="rounded border border-slate-300 px-3 py-2 text-sm font-semibold"
            >
              Export CSV (driver/week)
            </a>
          </div>
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="Pending Count" value={String(meta.totals.pendingCount)} />
        <MetricCard label="Pending Amount" value={money(meta.totals.pendingAmount)} />
        <MetricCard label="Paid Count" value={String(meta.totals.paidCount)} />
        <MetricCard label="Paid Amount" value={money(meta.totals.paidAmount)} />
        <MetricCard label="Cash Collected By Rider" value={money(meta.cash.cashCollectedByRider)} />
        <MetricCard label="Cash Due To Rider" value={money(meta.cash.cashDueToRider)} />
        <MetricCard label="Cash Due To Platform" value={money(meta.cash.cashDueToPlatform)} />
        <MetricCard label="Net Settlement" value={money(meta.cash.netSettlement)} />
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-lg font-semibold">Pending payouts</h3>
          <button
            type="button"
            onClick={bulkPaySelected}
            disabled={paying || !selectedIds.length}
            className="rounded bg-emerald-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {paying ? "Paying..." : "Mark selected paid"}
          </button>
        </div>
        <PayoutTable
          rows={pendingRows}
          showCheckbox
          selectedMap={selectedMap}
          onToggle={(payoutId, checked) =>
            setSelectedMap((prev) => ({
              ...prev,
              [payoutId]: checked,
            }))
          }
          loading={loading}
          emptyText="No pending payouts for this week."
        />
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h3 className="mb-3 text-lg font-semibold">Paid history</h3>
        <PayoutTable
          rows={paidRows}
          loading={loading}
          emptyText="No paid payouts for this week."
        />
      </section>
    </section>
  );
}

function PayoutTable({
  rows,
  loading = false,
  emptyText,
  showCheckbox = false,
  selectedMap = {},
  onToggle,
}: {
  rows: DriverRow[];
  loading?: boolean;
  emptyText: string;
  showCheckbox?: boolean;
  selectedMap?: Record<string, boolean>;
  onToggle?: (payoutId: string, checked: boolean) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead className="text-left text-slate-600">
          <tr>
            {showCheckbox ? <th className="border-b py-2">Sel</th> : null}
            <th className="border-b py-2">Created</th>
            <th className="border-b py-2">Order</th>
            <th className="border-b py-2">Business</th>
            <th className="border-b py-2">Amount</th>
            <th className="border-b py-2">Fee</th>
            <th className="border-b py-2">Margin</th>
            <th className="border-b py-2">Status</th>
            <th className="border-b py-2">Paid At</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.payoutId} className="border-b last:border-b-0">
              {showCheckbox ? (
                <td className="py-2">
                  <input
                    type="checkbox"
                    checked={Boolean(selectedMap[row.payoutId])}
                    onChange={(event) => onToggle?.(row.payoutId, event.target.checked)}
                  />
                </td>
              ) : null}
              <td className="py-2">{formatDate(row.createdAt)}</td>
              <td className="py-2 font-mono text-xs">{row.orderId || "-"}</td>
              <td className="py-2 font-mono text-xs">{row.businessId || "-"}</td>
              <td className="py-2">{money(row.amount)}</td>
              <td className="py-2">{money(row.deliveryFeeCharged)}</td>
              <td className="py-2">{money(row.platformMargin)}</td>
              <td className="py-2">{row.status || "-"}</td>
              <td className="py-2">{formatDate(row.paidAt)}</td>
            </tr>
          ))}
          {!rows.length ? (
            <tr>
              <td colSpan={showCheckbox ? 9 : 8} className="py-3 text-center text-slate-500">
                {loading ? "Loading..." : emptyText}
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <article className="rounded-xl border border-slate-200 bg-white p-4">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-1 text-lg font-semibold">{value}</p>
    </article>
  );
}
