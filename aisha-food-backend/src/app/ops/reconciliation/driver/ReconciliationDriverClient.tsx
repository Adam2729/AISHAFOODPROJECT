"use client";

import { useEffect, useMemo, useState } from "react";

type Totals = {
  count?: number;
  cashCollectedByRider?: number;
  cashDueToRider?: number;
  cashDueToPlatform?: number;
  netSettlement?: number;
};

type RowPreview = {
  payoutId: string;
  orderId: string;
  status: string;
  amount: number;
  deliveryFeeCharged: number;
  platformMargin: number;
  createdAt?: string | Date | null;
  paidAt?: string | Date | null;
};

type DriverReconResponse = {
  ok?: boolean;
  cityId?: string;
  cityCode?: string;
  weekKey?: string;
  driverId?: string;
  totals?: {
    pending?: Totals;
    paid?: Totals;
    all?: Totals;
  };
  rowsPreview?: RowPreview[];
  error?: { message?: string } | string;
};

function pickError(error: unknown, fallback: string) {
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message?: string }).message || fallback);
  }
  return fallback;
}

function money(value: unknown) {
  return Number(value || 0).toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

function formatDate(value: string | Date | null | undefined) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString();
}

export default function ReconciliationDriverClient({
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
  const [data, setData] = useState<DriverReconResponse | null>(null);

  async function loadData() {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({
        key: adminKey,
        cityId,
        weekKey,
        driverId,
      });
      const res = await fetch(`/api/ops/driver-reconciliation?${params.toString()}`, {
        cache: "no-store",
      });
      const json = (await res.json().catch(() => null)) as DriverReconResponse | null;
      if (!res.ok || !json?.ok) {
        throw new Error(pickError(json?.error, "Could not load reconciliation detail."));
      }
      setData(json);
    } catch (requestError: unknown) {
      setError(
        requestError instanceof Error ? requestError.message : "Could not load reconciliation detail."
      );
      setData(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, [cityId, weekKey, driverId]); // eslint-disable-line react-hooks/exhaustive-deps

  const totals = useMemo(() => {
    return {
      pending: data?.totals?.pending || {},
      paid: data?.totals?.paid || {},
      all: data?.totals?.all || {},
    };
  }, [data?.totals]);

  const rows = useMemo(() => Array.isArray(data?.rowsPreview) ? data?.rowsPreview : [], [data]);

  return (
    <section className="space-y-4">
      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-lg font-semibold">Driver: {driverId}</h2>
            <p className="text-sm text-slate-600">
              City: {data?.cityCode || "-"} · Week: {data?.weekKey || weekKey}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <a
              href={`/ops/reconciliation?cityId=${encodeURIComponent(
                cityId
              )}&weekKey=${encodeURIComponent(weekKey)}`}
              className="rounded border border-slate-300 px-3 py-2 text-sm"
            >
              Back
            </a>
            <a
              href={`/api/ops/driver-reconciliation/export.csv?cityId=${encodeURIComponent(cityId)}&weekKey=${encodeURIComponent(
                weekKey
              )}&driverId=${encodeURIComponent(driverId)}`}
              className="rounded border border-slate-300 px-3 py-2 text-sm"
            >
              Export CSV
            </a>
            <button
              type="button"
              onClick={loadData}
              disabled={loading}
              className="rounded border border-slate-300 px-3 py-2 text-sm font-semibold disabled:opacity-50"
            >
              {loading ? "Loading..." : "Refresh"}
            </button>
          </div>
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-3">
        <MetricCard label="Pending net" value={money(totals.pending.netSettlement)} />
        <MetricCard label="Paid net" value={money(totals.paid.netSettlement)} />
        <MetricCard label="Total net" value={money(totals.all.netSettlement)} />
        <MetricCard label="Pending count" value={String(totals.pending.count || 0)} />
        <MetricCard label="Paid count" value={String(totals.paid.count || 0)} />
        <MetricCard label="Cash collected" value={money(totals.all.cashCollectedByRider)} />
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <p className="text-sm text-slate-700">
          netSettlement = cashDueToRider - cashDueToPlatform. Positivo: plataforma paga al
          rider. Negativo: rider debe entregar diferencia a plataforma.
        </p>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h3 className="mb-3 text-lg font-semibold">Ultimos 50 payouts</h3>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="text-left text-slate-600">
              <tr>
                <th className="border-b py-2">Payout</th>
                <th className="border-b py-2">Order</th>
                <th className="border-b py-2">Status</th>
                <th className="border-b py-2">Amount</th>
                <th className="border-b py-2">Fee</th>
                <th className="border-b py-2">Margin</th>
                <th className="border-b py-2">Created</th>
                <th className="border-b py-2">Paid At</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.payoutId} className="border-b last:border-b-0">
                  <td className="py-2 font-mono text-xs">{row.payoutId}</td>
                  <td className="py-2 font-mono text-xs">{row.orderId || "-"}</td>
                  <td className="py-2">{row.status}</td>
                  <td className="py-2">{money(row.amount)}</td>
                  <td className="py-2">{money(row.deliveryFeeCharged)}</td>
                  <td className="py-2">{money(row.platformMargin)}</td>
                  <td className="py-2">{formatDate(row.createdAt)}</td>
                  <td className="py-2">{formatDate(row.paidAt)}</td>
                </tr>
              ))}
              {!rows.length ? (
                <tr>
                  <td colSpan={8} className="py-3 text-center text-slate-500">
                    No payouts yet for this driver/week.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </section>
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
