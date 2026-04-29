"use client";

import { useMemo, useState } from "react";

type PayoutRow = {
  payoutId: string;
  orderId: string;
  amount: number;
  deliveryFeeCharged: number;
  platformMargin: number;
  status: string;
  createdAt: string | Date | null;
  paidAt: string | Date | null;
};

type BulkResponse = {
  ok: boolean;
  updatedCount?: number;
  requestedCount?: number;
  payoutIdsUpdated?: string[];
  skipped?: Array<{ payoutId: string; reason: string }>;
  error?: { message?: string } | string;
};

type DriverPayoutsBulkTableProps = {
  rows: PayoutRow[];
  adminKey: string;
  cityId: string;
  weekKey: string;
  driverId: string;
  onUpdated: () => Promise<void> | void;
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

export default function DriverPayoutsBulkTable({
  rows,
  adminKey,
  cityId,
  weekKey,
  driverId,
  onUpdated,
}: DriverPayoutsBulkTableProps) {
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState("");
  const [error, setError] = useState("");

  const selectedIds = useMemo(() => {
    return Object.entries(selected)
      .filter(([, checked]) => checked)
      .map(([id]) => id);
  }, [selected]);

  async function markSelectedPaid() {
    if (!selectedIds.length) return;
    setLoading(true);
    setError("");
    setSuccess("");
    try {
      const res = await fetch(`/api/admin/driver-payouts/mark-paid-bulk`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cityId,
          weekKey,
          driverId,
          payoutIds: selectedIds,
        }),
      });
      const json = (await res.json().catch(() => null)) as BulkResponse | null;
      if (!res.ok || !json?.ok) {
        throw new Error(pickError(json?.error, "Could not mark selected payouts paid."));
      }
      const updatedCount = Number(json.updatedCount || 0);
      const skippedCount = Array.isArray(json.skipped) ? json.skipped.length : 0;
      setSuccess(`Updated ${updatedCount} payout(s). Skipped ${skippedCount}.`);
      setSelected({});
      await onUpdated();
    } catch (requestError: unknown) {
      setError(requestError instanceof Error ? requestError.message : "Could not mark selected payouts paid.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">Pending Payouts</h2>
        <button
          type="button"
          onClick={markSelectedPaid}
          disabled={loading || !selectedIds.length}
          className="rounded bg-emerald-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {loading ? "Saving..." : "Mark selected paid"}
        </button>
      </div>

      {error ? <p className="mb-3 text-sm text-red-600">{error}</p> : null}
      {success ? <p className="mb-3 text-sm text-emerald-700">{success}</p> : null}

      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="text-left text-slate-600">
            <tr>
              <th className="border-b py-2">Sel</th>
              <th className="border-b py-2">Payout</th>
              <th className="border-b py-2">Order</th>
              <th className="border-b py-2">Amount</th>
              <th className="border-b py-2">Fee</th>
              <th className="border-b py-2">Margin</th>
              <th className="border-b py-2">Created</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.payoutId} className="border-b last:border-b-0">
                <td className="py-2">
                  <input
                    type="checkbox"
                    checked={Boolean(selected[row.payoutId])}
                    onChange={(event) => {
                      const checked = event.target.checked;
                      setSelected((prev) => ({ ...prev, [row.payoutId]: checked }));
                    }}
                  />
                </td>
                <td className="py-2 font-mono text-xs">{row.payoutId}</td>
                <td className="py-2 font-mono text-xs">{row.orderId || "-"}</td>
                <td className="py-2">{money(row.amount)}</td>
                <td className="py-2">{money(row.deliveryFeeCharged)}</td>
                <td className="py-2">{money(row.platformMargin)}</td>
                <td className="py-2">{formatDate(row.createdAt)}</td>
              </tr>
            ))}
            {!rows.length ? (
              <tr>
                <td colSpan={7} className="py-3 text-center text-slate-500">
                  No pending payouts.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}

