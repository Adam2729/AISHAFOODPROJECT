"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type BreakdownRow = {
  cityId: string;
  code: string;
  name: string;
  ordersTotal: number;
  delivered: number;
  cancelled: number;
  commissionTotal: number;
  platformDeliveryMarginTotal: number;
  riderPayoutTotal: number;
  assignedCount: number;
  unassignedCount: number;
};

type BreakdownResponse = {
  ok: boolean;
  weekKey?: string;
  rows?: BreakdownRow[];
  error?: { message?: string } | string;
};

function pickError(error: unknown, fallback: string) {
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message?: string }).message || fallback);
  }
  return fallback;
}

function asNumber(value: unknown) {
  const num = Number(value || 0);
  return Number.isFinite(num) ? num : 0;
}

function money(value: unknown) {
  return Number(value || 0).toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

export default function AnalyticsByCityClient({
  adminKey,
  initialWeekKey,
}: {
  adminKey: string;
  initialWeekKey: string;
}) {
  const router = useRouter();
  const [weekKey, setWeekKey] = useState(initialWeekKey);
  const [rows, setRows] = useState<BreakdownRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    params.set("key", adminKey);
    params.set("weekKey", weekKey);
    return params.toString();
  }, [adminKey, weekKey]);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/ops/analytics/breakdown?${queryString}`, {
        cache: "no-store",
      });
      const json = (await res.json().catch(() => null)) as BreakdownResponse | null;
      if (!res.ok || !json?.ok) {
        throw new Error(pickError(json?.error, "Could not load weekly breakdown."));
      }
      setRows(Array.isArray(json.rows) ? json.rows : []);
    } catch (requestError: unknown) {
      setError(
        requestError instanceof Error ? requestError.message : "Could not load weekly breakdown."
      );
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryString]);

  return (
    <section className="space-y-4">
      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <label className="text-sm">
              <span className="mb-1 block text-slate-600">Week Key</span>
              <input
                value={weekKey}
                onChange={(event) => setWeekKey(event.target.value)}
                placeholder="YYYY-Www"
                className="w-full rounded border border-slate-300 px-3 py-2"
              />
            </label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={load}
                disabled={loading}
                className="mt-2 rounded bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50 sm:mt-7"
              >
                {loading ? "Loading..." : "Refresh"}
              </button>
              <a
                href={`/api/ops/analytics/breakdown/export.csv?${queryString}`}
                target="_blank"
                rel="noreferrer"
                className="mt-2 rounded border border-slate-300 px-3 py-2 text-sm sm:mt-7"
              >
                Export breakdown CSV
              </a>
            </div>
          </div>
          <p className="text-xs text-slate-500">
            Active ops cities only. Click a row to open city-week detail.
          </p>
        </div>
      </section>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="text-left text-slate-600">
              <tr>
                <th className="border-b py-2">City</th>
                <th className="border-b py-2">Orders</th>
                <th className="border-b py-2">Delivered</th>
                <th className="border-b py-2">Cancelled</th>
                <th className="border-b py-2">Commission</th>
                <th className="border-b py-2">Delivery Margin</th>
                <th className="border-b py-2">Rider Payout</th>
                <th className="border-b py-2">Assigned</th>
                <th className="border-b py-2">Unassigned</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.cityId}
                  className="cursor-pointer border-b last:border-b-0 hover:bg-slate-50"
                  onClick={() =>
                    router.push(
                      `/ops/analytics/${encodeURIComponent(row.cityId)}?weekKey=${encodeURIComponent(weekKey)}`
                    )
                  }
                >
                  <td className="py-2">
                    <div className="font-medium">{row.name}</div>
                    <div className="text-xs text-slate-500">{row.code}</div>
                  </td>
                  <td className="py-2">{asNumber(row.ordersTotal)}</td>
                  <td className="py-2">{asNumber(row.delivered)}</td>
                  <td className="py-2">{asNumber(row.cancelled)}</td>
                  <td className="py-2">{money(row.commissionTotal)}</td>
                  <td className="py-2">{money(row.platformDeliveryMarginTotal)}</td>
                  <td className="py-2">{money(row.riderPayoutTotal)}</td>
                  <td className="py-2">{asNumber(row.assignedCount)}</td>
                  <td className="py-2">{asNumber(row.unassignedCount)}</td>
                </tr>
              ))}
              {!rows.length ? (
                <tr>
                  <td colSpan={9} className="py-3 text-center text-slate-500">
                    No city rows for this week yet.
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
