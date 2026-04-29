"use client";

import { useEffect, useState } from "react";
import DriverPayoutsBulkTable from "@/components/admin/DriverPayoutsBulkTable";

type DriverResponse = {
  ok: boolean;
  driver?: { driverId?: string; driverRef?: string };
  weekKey?: string;
  cityId?: string;
  totals?: {
    pendingCount?: number;
    pendingAmount?: number;
    paidCount?: number;
    paidAmount?: number;
    cashCollected?: number;
    platformMargin?: number;
    cashDueToRider?: number;
    netSettlement?: number;
  };
  pending?: Array<{
    payoutId: string;
    orderId: string;
    amount: number;
    deliveryFeeCharged: number;
    platformMargin: number;
    status: string;
    createdAt: string | Date | null;
    paidAt: string | Date | null;
  }>;
  paid?: Array<{
    payoutId: string;
    orderId: string;
    amount: number;
    deliveryFeeCharged: number;
    platformMargin: number;
    status: string;
    createdAt: string | Date | null;
    paidAt: string | Date | null;
  }>;
  error?: { message?: string } | string;
};

function money(value: number) {
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

export default function DriverPayoutsDriverClient({
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
  const [data, setData] = useState<DriverResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function loadData() {
    if (!cityId || !weekKey || !driverId) return;
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({
        key: adminKey,
        cityId,
        weekKey,
        driverId,
      });
      const res = await fetch(`/api/admin/driver-payouts/driver?${params.toString()}`, {
        cache: "no-store",
      });
      const json = (await res.json().catch(() => null)) as DriverResponse | null;
      if (!res.ok || !json?.ok) {
        throw new Error(pickError(json?.error, "Could not load driver payout details."));
      }
      setData(json);
    } catch (requestError: unknown) {
      setError(requestError instanceof Error ? requestError.message : "Could not load driver payout details.");
      setData(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, [cityId, weekKey, driverId]); // eslint-disable-line react-hooks/exhaustive-deps

  const totals = data?.totals || {};
  const pendingRows = Array.isArray(data?.pending) ? data.pending : [];
  const paidRows = Array.isArray(data?.paid) ? data.paid : [];

  return (
    <section className="space-y-4">
      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="Pending Count" value={String(Number(totals.pendingCount || 0))} />
        <MetricCard label="Pending Amount" value={money(Number(totals.pendingAmount || 0))} />
        <MetricCard label="Paid Count" value={String(Number(totals.paidCount || 0))} />
        <MetricCard label="Paid Amount" value={money(Number(totals.paidAmount || 0))} />
        <MetricCard label="Cash Collected" value={money(Number(totals.cashCollected || 0))} />
        <MetricCard label="Platform Margin" value={money(Number(totals.platformMargin || 0))} />
        <MetricCard label="Cash Due To Rider" value={money(Number(totals.cashDueToRider || 0))} />
        <MetricCard label="Net Settlement" value={money(Number(totals.netSettlement || 0))} />
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">
            Driver: {String(data?.driver?.driverRef || "") || driverId}
          </h2>
          <a
            href={`/api/admin/driver-payouts/export/driver-week?cityId=${encodeURIComponent(cityId)}&weekKey=${encodeURIComponent(
              weekKey
            )}&driverId=${encodeURIComponent(driverId)}&status=all`}
            className="rounded border border-slate-300 px-3 py-2 text-sm font-semibold"
          >
            Export CSV (driver/week)
          </a>
        </div>
      </section>

      <DriverPayoutsBulkTable
        rows={pendingRows}
        adminKey={adminKey}
        cityId={cityId}
        weekKey={weekKey}
        driverId={driverId}
        onUpdated={loadData}
      />

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-2 text-lg font-semibold">Paid History</h2>
        {loading ? <p className="mb-2 text-sm text-slate-500">Loading...</p> : null}
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="text-left text-slate-600">
              <tr>
                <th className="border-b py-2">Payout</th>
                <th className="border-b py-2">Order</th>
                <th className="border-b py-2">Amount</th>
                <th className="border-b py-2">Fee</th>
                <th className="border-b py-2">Margin</th>
                <th className="border-b py-2">Paid At</th>
              </tr>
            </thead>
            <tbody>
              {paidRows.map((row) => (
                <tr key={row.payoutId} className="border-b last:border-b-0">
                  <td className="py-2 font-mono text-xs">{row.payoutId}</td>
                  <td className="py-2 font-mono text-xs">{row.orderId || "-"}</td>
                  <td className="py-2">{money(row.amount)}</td>
                  <td className="py-2">{money(row.deliveryFeeCharged)}</td>
                  <td className="py-2">{money(row.platformMargin)}</td>
                  <td className="py-2">{formatDate(row.paidAt)}</td>
                </tr>
              ))}
              {!paidRows.length ? (
                <tr>
                  <td colSpan={6} className="py-3 text-center text-slate-500">
                    No paid history.
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

