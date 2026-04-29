"use client";

import { useEffect, useMemo, useState } from "react";

type BreakdownRow = {
  cityId: string;
  cityCode: string;
  cityName: string;
  metrics?: {
    ordersTotal?: number;
    delivered?: number;
    cancelled?: number;
  };
  finance?: {
    commissionTotal?: number;
    platformDeliveryMarginTotal?: number;
    netPlatformTakeApprox?: number;
  };
  dispatch?: {
    assignedCount?: number;
    unassignedCount?: number;
  };
};

type BreakdownResponse = {
  ok: boolean;
  weekKey?: string;
  range?: { fromIso?: string; toIso?: string; mode?: "week" | "range" };
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

function money(value: unknown) {
  return Number(value || 0).toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

function asNumber(value: unknown) {
  const num = Number(value || 0);
  return Number.isFinite(num) ? num : 0;
}

export default function CityBreakdownClient({
  adminKey,
  initialWeekKey,
  initialFrom,
  initialTo,
}: {
  adminKey: string;
  initialWeekKey: string;
  initialFrom: string;
  initialTo: string;
}) {
  const [weekKey, setWeekKey] = useState(initialWeekKey);
  const [fromDate, setFromDate] = useState(initialFrom);
  const [toDate, setToDate] = useState(initialTo);
  const [useRange, setUseRange] = useState(Boolean(initialFrom && initialTo));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [data, setData] = useState<BreakdownResponse | null>(null);

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    params.set("key", adminKey);
    if (useRange && fromDate && toDate) {
      params.set("from", fromDate);
      params.set("to", toDate);
    } else {
      params.set("weekKey", weekKey);
    }
    return params.toString();
  }, [adminKey, useRange, fromDate, toDate, weekKey]);

  async function loadData() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/ops/analytics/city-breakdown?${queryString}`, {
        cache: "no-store",
      });
      const json = (await res.json().catch(() => null)) as BreakdownResponse | null;
      if (!res.ok || !json?.ok) {
        throw new Error(pickError(json?.error, "Could not load city breakdown."));
      }
      setData(json);
    } catch (requestError: unknown) {
      setError(
        requestError instanceof Error ? requestError.message : "Could not load city breakdown."
      );
      setData(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, [weekKey, fromDate, toDate, useRange]); // eslint-disable-line react-hooks/exhaustive-deps

  const rows = Array.isArray(data?.rows) ? data.rows : [];

  return (
    <section className="space-y-4">
      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="grid gap-3 md:grid-cols-5">
          <label className="text-sm">
            <span className="mb-1 block text-slate-600">Week Key</span>
            <input
              value={weekKey}
              onChange={(event) => setWeekKey(event.target.value)}
              placeholder="YYYY-Www"
              disabled={useRange}
              className="w-full rounded border border-slate-300 px-3 py-2 disabled:bg-slate-100"
            />
          </label>

          <label className="text-sm">
            <span className="mb-1 block text-slate-600">From</span>
            <input
              type="date"
              value={fromDate}
              onChange={(event) => setFromDate(event.target.value)}
              disabled={!useRange}
              className="w-full rounded border border-slate-300 px-3 py-2 disabled:bg-slate-100"
            />
          </label>

          <label className="text-sm">
            <span className="mb-1 block text-slate-600">To</span>
            <input
              type="date"
              value={toDate}
              onChange={(event) => setToDate(event.target.value)}
              disabled={!useRange}
              className="w-full rounded border border-slate-300 px-3 py-2 disabled:bg-slate-100"
            />
          </label>

          <div className="flex flex-col justify-end gap-2">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={useRange}
                onChange={(event) => setUseRange(event.target.checked)}
              />
              Use date range
            </label>
          </div>

          <div className="flex items-end gap-2">
            <button
              type="button"
              onClick={loadData}
              disabled={loading}
              className="rounded bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              {loading ? "Loading..." : "Refresh"}
            </button>
            <a
              href={`/api/ops/analytics/city-breakdown?${queryString}`}
              target="_blank"
              rel="noreferrer"
              className="rounded border border-slate-300 px-3 py-2 text-sm"
            >
              Export JSON
            </a>
          </div>
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
                <th className="border-b py-2">Net Take Approx</th>
                <th className="border-b py-2">Assigned</th>
                <th className="border-b py-2">Unassigned</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.cityId} className="border-b last:border-b-0">
                  <td className="py-2">
                    <div className="font-medium">{row.cityName}</div>
                    <div className="text-xs text-slate-500">{row.cityCode}</div>
                  </td>
                  <td className="py-2">{asNumber(row.metrics?.ordersTotal)}</td>
                  <td className="py-2">{asNumber(row.metrics?.delivered)}</td>
                  <td className="py-2">{asNumber(row.metrics?.cancelled)}</td>
                  <td className="py-2">{money(row.finance?.commissionTotal)}</td>
                  <td className="py-2">{money(row.finance?.platformDeliveryMarginTotal)}</td>
                  <td className="py-2">{money(row.finance?.netPlatformTakeApprox)}</td>
                  <td className="py-2">{asNumber(row.dispatch?.assignedCount)}</td>
                  <td className="py-2">{asNumber(row.dispatch?.unassignedCount)}</td>
                </tr>
              ))}
              {!rows.length ? (
                <tr>
                  <td colSpan={9} className="py-3 text-center text-slate-500">
                    No city rows for the selected period.
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
